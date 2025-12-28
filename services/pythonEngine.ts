import { Candle, RLConfig, RLTrainingStep } from '../types';

// --- TYPES ---
export interface PythonSignal {
  time: string;
  action: 'BUY' | 'SELL' | 'CLOSE_ALL' | 'CANCEL';
  price: number | null;
  size: number;
  reason?: string;
  orderId?: string;
  limitPrice?: number;
  orderType?: 'MARKET' | 'LIMIT';
}

// --- WORKER SCRIPT ---
// We use a function to generate the worker code string to avoid complex escaping issues with nested template literals.
const getWorkerCode = () => {
    // The Python wrapper code (running inside Pyodide)
    const pythonWrapperTemplate = `
import json
import math
import sys
import traceback
import inspect
import random
# Ensure pandas/numpy are available if imported by user
import numpy as np
import pandas as pd

# --- JSON Encoder for Numpy Types ---
class NumpyEncoder(json.JSONEncoder):
    def default(self, obj):
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj)
        if isinstance(obj, np.bool_):
            return bool(obj)
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        return super(NumpyEncoder, self).default(obj)

def safe_float(val):
    try:
        f = float(val)
        if math.isnan(f) or math.isinf(f):
            return 0.0
        return f
    except:
        return 0.0

# Setup Data
try:
    if 'raw_data_json' in globals():
        raw_data = json.loads(raw_data_json)
    if 'params_json' in globals():
        params = json.loads(params_json)
except Exception as e:
    pass # Might be in RL mode

signals = []

class StrategyContext:
    def __init__(self):
        self.signals = []
        self.current_candle = None
        self.order_counter = 0
        
    def order(self, action, size=1, price=None, reason=""):
        if isinstance(price, str) and reason == "":
            reason = price
            price = None
        self.order_counter += 1
        order_id = f"ORD-{self.order_counter}"
        if self.current_candle:
            order_type = "LIMIT" if price is not None else "MARKET"
            limit_price = None
            if price is not None:
                try:
                    limit_price = float(price)
                except Exception:
                    limit_price = None
                    order_type = "MARKET"
            signal_price = limit_price if limit_price is not None else self.current_candle['close']
            self.signals.append({
                "time": self.current_candle['time'],
                "action": action,
                "price": signal_price,
                "size": size,
                "reason": reason,
                "orderId": order_id,
                "orderType": order_type,
                "limitPrice": limit_price
            })
        return order_id

    def cancel(self, order_id, reason=""):
        if self.current_candle and order_id:
            self.signals.append({
                "time": self.current_candle['time'],
                "action": "CANCEL",
                "price": None,
                "size": 0,
                "reason": reason,
                "orderId": order_id
            })

    def close_all(self, reason=""):
        if self.current_candle:
            self.signals.append({
                "time": self.current_candle['time'],
                "action": "CLOSE_ALL",
                "price": self.current_candle['close'],
                "size": 0,
                "reason": reason
            })
    
    def sma(self, data, period):
        if len(data) < period:
            return [data[-1]] * len(data)
        
        ret = []
        curr = sum(data[:period]) / period
        ret = [curr] * (period - 1)
        ret.append(curr)
        
        window_sum = sum(data[:period])
        for i in range(period, len(data)):
            window_sum = window_sum - data[i-period] + data[i]
            ret.append(window_sum / period)
        return ret

# --- DEEP Q-LEARNING (DQN) IMPLEMENTATION (Pure NumPy) ---

class MicroModel:
    """A simple 2-layer Neural Network using NumPy"""
    def __init__(self, input_dim, hidden_dim, output_dim, learning_rate=0.01):
        # He Initialization
        self.W1 = np.random.randn(input_dim, hidden_dim) * np.sqrt(2. / input_dim)
        self.b1 = np.zeros((1, hidden_dim))
        self.W2 = np.random.randn(hidden_dim, output_dim) * np.sqrt(2. / hidden_dim)
        self.b2 = np.zeros((1, output_dim))
        self.lr = learning_rate

        # Cache for backprop
        self.cache = {}

    def forward(self, X):
        # X shape: (batch_size, input_dim)
        z1 = np.dot(X, self.W1) + self.b1
        a1 = np.maximum(0, z1) # ReLU
        z2 = np.dot(a1, self.W2) + self.b2
        
        self.cache = {'X': X, 'z1': z1, 'a1': a1, 'z2': z2}
        return z2 # Linear output (Q-values)

    def backward(self, d_loss_output):
        # d_loss_output: Gradient of Loss w.r.t Output (z2)
        # Shape: (batch_size, output_dim)
        m = d_loss_output.shape[0]
        
        # Layer 2 Gradients
        dW2 = np.dot(self.cache['a1'].T, d_loss_output)
        db2 = np.sum(d_loss_output, axis=0, keepdims=True)
        
        # Layer 1 Gradients
        da1 = np.dot(d_loss_output, self.W2.T)
        dz1 = da1 * (self.cache['z1'] > 0) # ReLU derivative
        
        dW1 = np.dot(self.cache['X'].T, dz1)
        db1 = np.sum(dz1, axis=0, keepdims=True)
        
        # Update Weights (SGD)
        # Clip gradients to prevent explosion
        np.clip(dW1, -1.0, 1.0, out=dW1)
        np.clip(dW2, -1.0, 1.0, out=dW2)
        
        self.W1 -= self.lr * (dW1 / m)
        self.b1 -= self.lr * (db1 / m)
        self.W2 -= self.lr * (dW2 / m)
        self.b2 -= self.lr * (db2 / m)

    def get_weights(self):
        return {
            'W1': self.W1.tolist(), 'b1': self.b1.tolist(),
            'W2': self.W2.tolist(), 'b2': self.b2.tolist()
        }

class ReplayBuffer:
    def __init__(self, capacity=2000):
        self.capacity = capacity
        self.buffer = []
        self.position = 0

    def push(self, state, action, reward, next_state, done):
        if len(self.buffer) < self.capacity:
            self.buffer.append(None)
        self.buffer[self.position] = (state, action, reward, next_state, done)
        self.position = (self.position + 1) % self.capacity

    def sample(self, batch_size):
        return random.sample(self.buffer, batch_size)

    def __len__(self):
        return len(self.buffer)

class DQNAgent:
    def __init__(self, state_dim, action_dim=3, hidden_dim=24, lr=0.001, gamma=0.95, epsilon=1.0, epsilon_decay=0.995, batch_size=32):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.gamma = gamma
        self.epsilon = epsilon
        self.epsilon_min = 0.01
        self.epsilon_decay = epsilon_decay
        self.batch_size = batch_size

        # Policy Network
        self.model = MicroModel(state_dim, hidden_dim, action_dim, lr)
        # Target Network (Not strictly necessary for simple MicroNN convergence demo, but good practice. 
        # For simplicity/speed in JS Worker, we use single net for now, or update periodically)
        
        self.memory = ReplayBuffer(5000)

    def act(self, state):
        if np.random.rand() <= self.epsilon:
            return random.randrange(self.action_dim)
        
        state_tensor = np.array([state], dtype=np.float32)
        q_values = self.model.forward(state_tensor)
        return np.argmax(q_values[0])

    def remember(self, state, action, reward, next_state, done):
        self.memory.push(state, action, reward, next_state, done)

    def replay(self):
        if len(self.memory) < self.batch_size:
            return 0.0

        minibatch = self.memory.sample(self.batch_size)
        
        # Vectorized batch processing
        states = np.array([m[0] for m in minibatch])
        actions = np.array([m[1] for m in minibatch])
        rewards = np.array([m[2] for m in minibatch])
        next_states = np.array([m[3] for m in minibatch])
        dones = np.array([m[4] for m in minibatch])

        # Current Q values
        current_qs = self.model.forward(states)
        
        # Next Q values
        next_qs = self.model.forward(next_states)
        max_next_qs = np.max(next_qs, axis=1)
        
        # Target Q calculation
        target_qs = current_qs.copy()
        
        for i in range(self.batch_size):
            if dones[i]:
                target_qs[i, actions[i]] = rewards[i]
            else:
                target_qs[i, actions[i]] = rewards[i] + self.gamma * max_next_qs[i]
        
        # Gradient of Loss (MSE) -> (Predicted - Target)
        d_loss = (current_qs - target_qs)
        
        # Backprop
        self.model.backward(d_loss)
        
        return np.mean(d_loss**2)

    def decay_epsilon(self):
        if self.epsilon > self.epsilon_min:
            self.epsilon *= self.epsilon_decay

    def export_policy_code(self):
        w = self.model.get_weights()
        
        code = "import numpy as np\\n\\n"
        code += "class RLStrategy:\\n"
        code += "    def __init__(self):\\n"
        code += "        self.position = 0\\n"
        code += "        # Pre-trained Weights (DQN)\\n"
        code += f"        self.W1 = np.array({w['W1']})\\n"
        code += f"        self.b1 = np.array({w['b1']})\\n"
        code += f"        self.W2 = np.array({w['W2']})\\n"
        code += f"        self.b2 = np.array({w['b2']})\\n\\n"
        
        code += "    def forward(self, x):\\n"
        code += "        z1 = np.dot(x, self.W1) + self.b1\\n"
        code += "        a1 = np.maximum(0, z1) # ReLU\\n"
        code += "        z2 = np.dot(a1, self.W2) + self.b2\\n"
        code += "        return z2\\n\\n"

        code += "    def on_tick(self, candles):\\n"
        code += "        if len(candles) < 50: return\\n"
        code += "        state = self.get_state(candles)\\n"
        code += "        state_vec = np.array([state])\\n"
        code += "        q_values = self.forward(state_vec)[0]\\n"
        code += "        action = int(np.argmax(q_values))\\n\\n"
        
        code += "        # Execute\\n"
        code += "        if action == 1:\\n"
        code += "            if self.position <= 0: self.order('BUY', 1, 'DQN-Buy')\\n"
        code += "            self.position = 1\\n"
        code += "        elif action == 2:\\n"
        code += "            if self.position >= 0: self.order('SELL', 1, 'DQN-Sell')\\n"
        code += "            self.position = -1\\n\\n"

        code += "    def get_state(self, candles):\\n"
        code += "        # TODO: Paste your CustomTradingEnv.get_state logic here\\n"
        code += "        # Ensure it returns a LIST/ARRAY of FLOATS (Normalized)\\n"
        code += "        return [0.0] * " + str(len(self.model.W1)) + " # Placeholder\\n"
        
        return code

# Default Environment (DQN Friendly - Normalized)
class TradingEnv:
    def __init__(self, candles_data):
        self.candles = candles_data
        self.df = pd.DataFrame(candles_data)
        self.df['close'] = self.df['close'].astype(float)
        
        # Calculate Indicators
        self.df['sma_fast'] = self.df['close'].rolling(10).mean()
        self.df['sma_slow'] = self.df['close'].rolling(30).mean()
        
        # RSI
        delta = self.df['close'].diff()
        gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
        loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
        rs = gain / loss
        self.df['rsi'] = 100 - (100 / (1 + rs))
        
        self.df = self.df.fillna(method='bfill').fillna(0)
        
        self.reset()
        
    def reset(self):
        self.current_step = 30 
        self.position = 0 
        self.entry_price = 0.0
        self.done = False
        return self.get_state()

    def get_state(self):
        # Continuous State Space for DQN (Normalized roughly -1 to 1 or 0 to 1)
        if self.current_step >= len(self.df):
            self.current_step = len(self.df) - 1
            
        row = self.df.iloc[self.current_step]
        
        # Normalize inputs
        rsi_norm = float(row['rsi']) / 100.0
        
        sma_diff = (row['sma_fast'] - row['sma_slow']) / row['close'] * 1000 # Scaling
        
        pos_norm = float(self.position) # -1, 0, 1
        
        # Return list of floats
        return [rsi_norm, sma_diff, pos_norm]

    def step(self, action):
        current_price = float(self.df.iloc[self.current_step]['close'])
        reward = 0.0
        
        # Transaction Cost Penalty (small)
        step_penalty = -0.1
        
        if action == 1: # BUY
            if self.position == -1: # Reverse
                pnl = (self.entry_price - current_price) * 200
                reward += pnl
                self.position = 0
            if self.position == 0:
                self.position = 1
                self.entry_price = current_price
        elif action == 2: # SELL
            if self.position == 1: # Reverse
                pnl = (current_price - self.entry_price) * 200
                reward += pnl
                self.position = 0
            if self.position == 0:
                self.position = -1
                self.entry_price = current_price
        # Action 0 = HOLD
        
        reward += step_penalty
        
        self.current_step += 1
        if self.current_step >= len(self.df) - 1:
            self.done = True
            # Force Close at end
            if self.position == 1: reward += (current_price - self.entry_price) * 200
            elif self.position == -1: reward += (self.entry_price - current_price) * 200
            
        # Scale Reward for NN stability (e.g., -1 to 1 range is better than -5000 to 5000)
        reward_scaled = reward / 1000.0 
            
        return self.get_state(), reward_scaled, self.done

# --- User Code Injection (Standard Mode) ---
__user_keys_before = set(globals().keys())
__user_ids_before = {k: id(v) for k, v in globals().items()}
{USER_CODE_PLACEHOLDER}
# ---------------------------
__user_keys_after = set(globals().keys())
__user_new_keys = __user_keys_after - __user_keys_before
__user_changed_keys = {k for k in (__user_keys_after & __user_keys_before) if id(globals().get(k)) != __user_ids_before.get(k)}
__user_effective_keys = __user_new_keys | __user_changed_keys

final_result_json = "[]"

try:
    if 'rl_config_json' in globals():
        # --- RL TRAIN MODE ---
        rl_conf = json.loads(rl_config_json)
        
        # Determine Environment Class
        EnvClass = TradingEnv # Default
        if 'custom_env_code' in globals() and custom_env_code.strip():
            try:
                # Execute the custom environment code to define the class in local scope
                exec(custom_env_code)
                if 'CustomTradingEnv' in locals():
                    EnvClass = CustomTradingEnv
            except Exception as e:
                pass # Fallback to default if error
        
        env = EnvClass(json.loads(raw_data_json))
        
        # Detect State Dimension
        initial_state = env.reset()
        state_dim = len(initial_state)
        
        agent = DQNAgent(
            state_dim=state_dim,
            action_dim=3,
            hidden_dim=rl_conf.get('hiddenLayerSize', 24),
            lr=rl_conf['learningRate'], 
            gamma=rl_conf['discountFactor'], 
            epsilon_decay=rl_conf['epsilonDecay'],
            batch_size=rl_conf.get('batchSize', 32)
        )
        
        episodes = rl_conf['episodes']
        history = []
        
        for e in range(episodes):
            state = env.reset()
            total_reward = 0
            wins = 0
            trades = 0
            step_limit = len(env.df) + 100
            steps = 0
            
            while True:
                action = agent.act(state)
                next_state, reward, done = env.step(action)
                agent.remember(state, action, reward, next_state, done)
                
                # Train the network
                loss = agent.replay()
                
                state = next_state
                total_reward += reward
                if reward > 0: wins += 1
                if action != 0: trades += 1
                steps += 1
                if done or steps > step_limit: break
            
            agent.decay_epsilon()
            
            if e % 5 == 0 or e == episodes - 1:
                win_rate = wins / trades if trades > 0 else 0.0
                step_data = {
                    "episode": int(e + 1),
                    "totalReward": safe_float(total_reward * 1000.0), # Unscale for display
                    "epsilon": safe_float(agent.epsilon),
                    "winRate": safe_float(win_rate)
                }
                history.append(step_data)
                if 'report_progress_js' in globals():
                    progress_payload = step_data.copy()
                    progress_payload['progress'] = float((e + 1) / episodes * 100)
                    report_progress_js(json.dumps(progress_payload, cls=NumpyEncoder))

        # Export code
        policy_code = agent.export_policy_code()
        
        generated_full_code = policy_code
        if 'custom_env_code' in globals() and custom_env_code.strip():
             generated_full_code = "# --- CUSTOM STATE LOGIC USED DURING TRAINING ---\\n"
             generated_full_code += custom_env_code + "\\n"
             generated_full_code += "# -----------------------------------------------\\n\\n"
             generated_full_code += policy_code

        final_result_json = json.dumps({
            "history": history,
            "generatedCode": generated_full_code
        }, cls=NumpyEncoder)
        
    else:
        # --- STANDARD BACKTEST MODE ---
        strategy_fn = None
        if 'on_tick' in __user_effective_keys and callable(locals().get('on_tick')):
            strategy_fn = locals()['on_tick']
        elif 'strategy' in __user_effective_keys and callable(locals().get('strategy')):
            strategy_fn = locals()['strategy']

        if strategy_fn:
            ctx = StrategyContext()
            if 'order' not in locals():
                def order(action, size=1, price=None, reason=""):
                    return ctx.order(action, size, price, reason)
            if 'close_all' not in locals():
                def close_all(reason=""):
                    return ctx.close_all(reason)
            if 'cancel' not in locals():
                def cancel(order_id, reason=""):
                    return ctx.cancel(order_id, reason)
            if 'sma' not in locals():
                def sma(data, period):
                    return ctx.sma(data, period)

            def call_strategy(candles):
                try:
                    param_count = len(inspect.signature(strategy_fn).parameters)
                except Exception:
                    param_count = 2
                if param_count <= 1:
                    return strategy_fn(candles)
                return strategy_fn(candles, ctx)

            class CandleObj:
                def __init__(self, d):
                    self.time = d['time']
                    self.open = d['open']
                    self.high = d['high']
                    self.low = d['low']
                    self.close = d['close']
                    self.volume = d['volume']
                    # Parse Level 2 Data if available
                    self.bids = []
                    self.asks = []
                    if 'orderBook' in d and d['orderBook']:
                         ob = d['orderBook']
                         if 'bids' in ob: self.bids = ob['bids']
                         if 'asks' in ob: self.asks = ob['asks']

            historical_candles = []
            max_lookback_val = None
            if 'max_lookback' in globals():
                try:
                    max_lookback_val = int(max_lookback)
                except Exception:
                    max_lookback_val = None

            if 'on_start' in __user_effective_keys and callable(locals().get('on_start')):
                try:
                    start_params = len(inspect.signature(locals()['on_start']).parameters)
                except Exception:
                    start_params = 0
                if start_params == 0:
                    locals()['on_start']()
                elif start_params == 1:
                    locals()['on_start'](ctx)

            for i, raw in enumerate(raw_data):
                c = CandleObj(raw)
                historical_candles.append(c)
                if max_lookback_val and len(historical_candles) > max_lookback_val:
                    historical_candles = historical_candles[-max_lookback_val:]
                ctx.current_candle = raw
                call_strategy(historical_candles)

            final_result_json = json.dumps(ctx.signals, cls=NumpyEncoder)
        else:
            target_class = None
            all_classes = []
            for name, obj in list(locals().items()):
                if name not in __user_effective_keys:
                    continue
                if isinstance(obj, type) and name != 'StrategyContext' and name != 'CandleObj' and name != 'TradingEnv' and name != 'DQNAgent' and name != 'MicroModel' and name != 'ReplayBuffer' and name != 'NumpyEncoder':
                     if obj.__module__ == '__main__': 
                         all_classes.append(obj)
            strategy_classes = [cls for cls in all_classes if hasattr(cls, 'on_tick')]
            if strategy_classes: target_class = strategy_classes[-1]
            elif all_classes: target_class = all_classes[-1]
            
            if not target_class:
                # Fallback
                for name, obj in list(locals().items()):
                     if name not in __user_effective_keys:
                          continue
                     if isinstance(obj, type) and name not in ['StrategyContext', 'CandleObj', 'type', 'TradingEnv', 'DQNAgent', 'MicroModel', 'ReplayBuffer', 'NumpyEncoder', 'CustomTradingEnv']:
                          target_class = obj
                          break

            if not target_class:
                raise Exception("No strategy class found.")

            try:
                strategy = target_class(**params)
            except TypeError as e:
                try: strategy = target_class()
                except TypeError: raise e

            ctx = StrategyContext()
            strategy.order = ctx.order
            strategy.close_all = ctx.close_all
            strategy.cancel = ctx.cancel
            if not hasattr(strategy, 'sma'): strategy.sma = ctx.sma

            class CandleObj:
                def __init__(self, d):
                    self.time = d['time']
                    self.open = d['open']
                    self.high = d['high']
                    self.low = d['low']
                    self.close = d['close']
                    self.volume = d['volume']
                    # Parse Level 2 Data if available
                    self.bids = []
                    self.asks = []
                    if 'orderBook' in d and d['orderBook']:
                         ob = d['orderBook']
                         if 'bids' in ob: self.bids = ob['bids']
                         if 'asks' in ob: self.asks = ob['asks']

            historical_candles = []
            max_lookback_val = None
            if 'max_lookback' in globals():
                try:
                    max_lookback_val = int(max_lookback)
                except Exception:
                    max_lookback_val = None
            if hasattr(strategy, 'on_start'): strategy.on_start()
            
            for i, raw in enumerate(raw_data):
                c = CandleObj(raw)
                historical_candles.append(c)
                if max_lookback_val and len(historical_candles) > max_lookback_val:
                    historical_candles = historical_candles[-max_lookback_val:]
                ctx.current_candle = raw
                strategy.on_tick(historical_candles)

            final_result_json = json.dumps(ctx.signals, cls=NumpyEncoder)

except Exception:
    error_msg = traceback.format_exc()
    final_result_json = json.dumps([{"error": error_msg}])

final_result_json
`;
    // We escape backticks inside the python code for the JS string wrapping
    // but the python code above uses single or double quotes, so it should be fine.
    
    // WORKER CODE TEMPLATE
    // FIX: Escape backslashes in the python code string before creating the worker script.
    // This ensures that escape sequences like '\n' in the Python code remain as '\n' in the worker's variable,
    // rather than being interpreted as actual newlines by the JS engine during string interpolation.
    const escapedPythonTemplate = pythonWrapperTemplate.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');

    return `
importScripts("https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js");

let pyodide = null;
let isReady = false;

const PYTHON_WRAPPER_TEMPLATE = \`${escapedPythonTemplate}\`;

self.onmessage = async (event) => {
    const { type, id, payload } = event.data;

    if (type === 'INIT') {
        try {
            if (!pyodide) {
                // @ts-ignore
                pyodide = await loadPyodide();
                await pyodide.loadPackage(["numpy", "pandas"]);
                isReady = true;
            }
            self.postMessage({ type: 'INIT_SUCCESS', id });
        } catch (e) {
            self.postMessage({ type: 'ERROR', id, error: e.toString() });
        }
    } 
    else if (type === 'RUN_STRATEGY') {
        if (!isReady) {
            self.postMessage({ type: 'ERROR', id, error: "Pyodide not ready" });
            return;
        }

        const { code, candles, params, maxLookbackCandles } = payload;

        try {
            pyodide.globals.set("raw_data_json", JSON.stringify(candles));
            pyodide.globals.set("params_json", JSON.stringify(params));
            if (maxLookbackCandles) {
                pyodide.globals.set("max_lookback", Number(maxLookbackCandles));
            } else {
                try { pyodide.globals.delete("max_lookback"); } catch(e){}
            }
            try { pyodide.globals.delete("rl_config_json"); } catch(e){}

            const fullScript = PYTHON_WRAPPER_TEMPLATE.replace('{USER_CODE_PLACEHOLDER}', code);
            const resultString = await pyodide.runPythonAsync(fullScript);
            const result = JSON.parse(resultString);

            if (Array.isArray(result) && result.length > 0 && result[0].error) {
                 throw new Error(result[0].error);
            }
            self.postMessage({ type: 'RUN_SUCCESS', id, result });

        } catch (e) {
            let msg = e.message || e.toString();
            if (msg.includes('PythonError:')) {
                msg = msg.split('PythonError:')[1];
            }
            self.postMessage({ type: 'ERROR', id, error: msg });
        }
    }
    else if (type === 'TRAIN_RL') {
        if (!isReady) {
            self.postMessage({ type: 'ERROR', id, error: "Pyodide not ready" });
            return;
        }
        
        const { candles, config, envCode } = payload;
        
        try {
            pyodide.globals.set("raw_data_json", JSON.stringify(candles));
            pyodide.globals.set("rl_config_json", JSON.stringify(config));
            
            if (envCode) {
                pyodide.globals.set("custom_env_code", envCode);
            } else {
                try { pyodide.globals.delete("custom_env_code"); } catch(e){}
            }
            
            const reportProgress = (jsonStr) => {
                 self.postMessage({ type: 'TRAIN_PROGRESS', id, payload: JSON.parse(jsonStr) });
            };
            pyodide.globals.set("report_progress_js", reportProgress);

            const fullScript = PYTHON_WRAPPER_TEMPLATE.replace('{USER_CODE_PLACEHOLDER}', '');
            
            const resultString = await pyodide.runPythonAsync(fullScript);
            const result = JSON.parse(resultString);
            
            if (Array.isArray(result) && result.length > 0 && result[0].error) {
                 throw new Error(result[0].error);
            }
            
            self.postMessage({ type: 'TRAIN_SUCCESS', id, result });
            
        } catch (e) {
            let msg = e.message || e.toString();
            if (msg.includes('PythonError:')) {
                msg = msg.split('PythonError:')[1];
            }
            self.postMessage({ type: 'ERROR', id, error: msg });
        }
    }
};
`;
};

// --- SERVICE IMPLEMENTATION ---

let worker: Worker | null = null;
const messageQueue = new Map<string, { resolve: (data: any) => void, reject: (err: any) => void, onProgress?: (p: any) => void }>();

type WorkerHandle = {
  worker: Worker;
  queue: Map<string, { resolve: (data: any) => void; reject: (err: any) => void; onProgress?: (p: any) => void }>;
};

const createWorkerHandle = (): WorkerHandle => {
  const blob = new Blob([getWorkerCode()], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  const workerInstance = new Worker(workerUrl);
  const queue = new Map<string, { resolve: (data: any) => void; reject: (err: any) => void; onProgress?: (p: any) => void }>();

  workerInstance.onmessage = (event) => {
    const { type, id, result, error, payload } = event.data;
    if (type === 'TRAIN_PROGRESS') {
      const handler = queue.get(id);
      if (handler && handler.onProgress) {
        handler.onProgress(payload);
      }
      return;
    }
    const handler = queue.get(id);
    if (handler) {
      if (type === 'ERROR') {
        handler.reject(new Error(error));
      } else {
        handler.resolve(result);
      }
      if (type === 'INIT_SUCCESS' || type === 'RUN_SUCCESS' || type === 'TRAIN_SUCCESS' || type === 'ERROR') {
        queue.delete(id);
      }
    }
  };

  return { worker: workerInstance, queue };
};

const initWorkerHandle = async (handle: WorkerHandle): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    const id = 'init-' + Date.now() + Math.random();
    handle.queue.set(id, { resolve, reject });
    handle.worker.postMessage({ type: 'INIT', id });
  });
};

const runPythonStrategyOnWorker = async (
  handle: WorkerHandle,
  code: string,
  candles: Candle[],
  params: any,
  options?: { maxLookbackCandles?: number }
): Promise<PythonSignal[]> => {
  return new Promise((resolve, reject) => {
    const id = 'run-' + Date.now() + Math.random();
    handle.queue.set(id, { resolve, reject });
    handle.worker.postMessage({
      type: 'RUN_STRATEGY',
      id,
      payload: { code, candles, params, maxLookbackCandles: options?.maxLookbackCandles }
    });
  });
};

const disposeWorkerPool = (handles: WorkerHandle[]) => {
  handles.forEach((handle) => {
    handle.worker.terminate();
  });
};

export const runPythonStrategyBatch = async (
  tasks: Array<{ code: string; candles: Candle[]; params: any; options?: { maxLookbackCandles?: number } }>,
  options?: { workerCount?: number; onProgress?: (completed: number, total: number) => void; shouldCancel?: () => boolean }
): Promise<Array<{ signals: PythonSignal[] | null; error?: string }>> => {
  if (tasks.length === 0) return [];
  const maxWorkers = Math.max(1, Math.min(options?.workerCount || 1, tasks.length));
  const handles = Array.from({ length: maxWorkers }, () => createWorkerHandle());
  await Promise.all(handles.map((handle) => initWorkerHandle(handle)));

  let nextIndex = 0;
  let completed = 0;
  const results: Array<{ signals: PythonSignal[] | null; error?: string }> = new Array(tasks.length);

  const runNext = async (handle: WorkerHandle) => {
    while (true) {
      if (options?.shouldCancel && options.shouldCancel()) return;
      const taskIndex = nextIndex++;
      if (taskIndex >= tasks.length) return;
      const task = tasks[taskIndex];
      try {
        const signals = await runPythonStrategyOnWorker(handle, task.code, task.candles, task.params, task.options);
        results[taskIndex] = { signals };
      } catch (e) {
        results[taskIndex] = { signals: null, error: (e as Error).message };
      } finally {
        completed += 1;
        if (options?.onProgress) {
          options.onProgress(completed, tasks.length);
        }
      }
    }
  };

  try {
    await Promise.all(handles.map((handle) => runNext(handle)));
  } finally {
    disposeWorkerPool(handles);
  }

  return results;
};

export const initPyodide = async () => {
  if (worker) return;

  const blob = new Blob([getWorkerCode()], { type: 'application/javascript' });
  const workerUrl = URL.createObjectURL(blob);
  worker = new Worker(workerUrl);

  worker.onmessage = (event) => {
    const { type, id, result, error, payload } = event.data;

    if (type === 'TRAIN_PROGRESS') {
        const handler = messageQueue.get(id);
        if (handler && handler.onProgress) {
            handler.onProgress(payload);
        }
        return;
    }

    const handler = messageQueue.get(id);
    if (handler) {
      if (type === 'ERROR') {
        handler.reject(new Error(error));
      } else {
        handler.resolve(result);
      }
      
      if (type === 'INIT_SUCCESS' || type === 'RUN_SUCCESS' || type === 'TRAIN_SUCCESS' || type === 'ERROR') {
          messageQueue.delete(id);
      }
    }
  };

  return new Promise<void>((resolve, reject) => {
    const id = 'init-' + Date.now();
    messageQueue.set(id, { resolve, reject });
    worker?.postMessage({ type: 'INIT', id });
  });
};

export const runPythonStrategy = async (
    code: string,
    candles: Candle[],
    params: any,
    options?: { maxLookbackCandles?: number }
): Promise<PythonSignal[]> => {
    if (!worker) throw new Error("Worker not initialized");
    
    return new Promise((resolve, reject) => {
        const id = 'run-' + Date.now() + Math.random();
        messageQueue.set(id, { resolve, reject });
        worker?.postMessage({
            type: 'RUN_STRATEGY',
            id,
            payload: { code, candles, params, maxLookbackCandles: options?.maxLookbackCandles }
        });
    });
};

export const trainRLAgent = async (
    candles: Candle[], 
    config: RLConfig,
    envCode: string | undefined,
    onProgress: (progress: number, step: RLTrainingStep) => void
): Promise<{ history: RLTrainingStep[], generatedCode: string }> => {
    if (!worker) throw new Error("Worker not initialized");

    return new Promise((resolve, reject) => {
        const id = 'train-' + Date.now() + Math.random();
        messageQueue.set(id, { 
            resolve, 
            reject,
            onProgress: (payload: any) => {
                const { progress, ...step } = payload;
                onProgress(progress, step);
            }
        });
        
        worker?.postMessage({
            type: 'TRAIN_RL',
            id,
            payload: { candles, config, envCode }
        });
    });
};

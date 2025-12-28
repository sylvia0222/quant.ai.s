import { Candle, Strategy, RLConfig, RLTrainingStep } from '../types';
import { getAppConfig } from './configService';

// --- 核心系統提示 ---

// 定義 pythonEngine.ts 內可用的 Python 策略介面規格
const STRATEGY_GUIDE_AI = `
# 策略開發說明書（AI）

本文件提供 AI 產生策略程式碼時的輸出規範與介面約束。

## 1. 輸出格式
- 只輸出 **Python 程式碼** 或 JSON（依呼叫端要求）。
- 不要輸出 Markdown code block 或多餘說明文字。
- 必須可直接在 Pyodide 執行。

## 2. 策略結構（擇一）
### 2.1 函式式（優先）
\`\`\`python
def on_tick(candles, ctx):
    ...
\`\`\`
可選：
\`\`\`python
def on_start(ctx):
    ...
\`\`\`

### 2.2 類別式（相容）
\`\`\`python
class MyStrategy:
    def __init__(self, ...):
        ...
    def on_tick(self, candles):
        ...
\`\`\`

## 3. 可用資料與方法
- \`candles\`：K 線物件列表（\`open/high/low/close/volume/time\`）。
- Level 2：\`c.bids\` / \`c.asks\`（最佳 5 檔）。
- 交易動作：
  - 函式式：\`ctx.order("BUY", size=1, price=None, reason="")\` / \`ctx.order("SELL", size=1, price=None, reason="")\`
  - 類別式：\`self.order("BUY", size=1, price=None, reason="")\` / \`self.order("SELL", size=1, price=None, reason="")\`
  - 取消委託：\`ctx.cancel(order_id, reason="")\` / \`self.cancel(order_id, reason="")\`
  - 平倉：\`ctx.close_all(reason="")\` / \`self.close_all(reason="")\`
- \`order()\` 會回傳 \`order_id\`，可用於 \`cancel()\`。
- 均線工具：\`ctx.sma(data, period)\`
- 參數：\`params\` 為 dict，可用 \`params.get("key", default)\` 讀取。

## 4. 狀態管理
- 引擎不會注入持倉狀態。
- 函式式：請自行使用全域變數（例如 \`position = 0\`）。
- 類別式：請在 \`__init__\` 定義 \`self.position = 0\`。

## 5. 限制與注意
- 只允許 \`numpy\` 與 \`pandas\`。
- 禁止匯入未內建的外部套件。
- 不要執行阻塞式 I/O 或長時間迴圈。
- 不要輸出會破壞 JSON 的內容。
`;

const STRATEGY_INTERFACE_CONTEXT = `
# SYSTEM: Python 策略 API 規範（嚴格遵守）

你正在為特定的 Python 回測引擎撰寫程式碼，請嚴格遵守以下規則：

1. **策略結構（擇一）**：
   - **函式式（建議）**：定義 \`def on_tick(candles, ctx):\` 或 \`def on_tick(candles):\`。
   - **類別式（相容）**：定義一個 Python 類別（例如 \`MyStrategy\`），實作 \`__init__\` 與 \`on_tick(self, candles)\`。

2. **資料存取**：
   - \`candles\` 為物件列表。
   - 取得最新 K 線：\`c = candles[-1]\`。
   - 可用欄位：\`c.open\`、\`c.high\`、\`c.low\`、\`c.close\`、\`c.volume\`、\`c.time\`（字串 "YYYY-MM-DD HH:mm"）。
   - 指標計算可轉為 Pandas Series：
     \`closes = pd.Series([c.close for c in candles])\`
   - **Level 2 委買賣**：
     - \`c.bids\`：列表 \`[{'price': 100, 'volume': 5}, ...]\`（最佳 5 檔買盤）。
     - \`c.asks\`：列表 \`[{'price': 101, 'volume': 2}, ...]\`（最佳 5 檔賣盤）。
     - 範例：\`if c.bids and c.bids[0]['volume'] > 500: ...\`（先檢查列表是否為空）。

3. **交易動作**：
   - 函式式：\`ctx.order('BUY', size=1, price=None, reason="")\`、\`ctx.order('SELL', size=1, price=None, reason="")\`
   - 類別式：\`self.order('BUY', size=1, price=None, reason="")\`、\`self.order('SELL', size=1, price=None, reason="")\`
   - 取消委託：\`ctx.cancel(order_id, reason="")\`、\`self.cancel(order_id, reason="")\`
   - 平倉：\`ctx.close_all(reason="")\`、\`self.close_all(reason="")\`
   - **注意**：\`order()\` 會回傳 \`order_id\`，可用於 \`cancel()\`，不會回傳成交結果。

4. **持倉追蹤**：
   - 引擎不會自動注入持倉狀態。
   - 函式式：請使用全域變數（例如 \`position = 0\`）並自行更新。
   - 類別式：請在 \`__init__\` 定義 \`self.position = 0\` 並自行更新。

5. **可用函式庫**：
   - \`numpy\` 可用為 \`np\`。
   - \`pandas\` 可用為 \`pd\`。
   - 不可使用其他外部函式庫（如 talib），除非自行用 numpy/pandas 實作。

6. **參數**：
   - 可使用 \`params\`（dict）取得前端參數，例如 \`fast = params.get('fast', 12)\`。

7. **輸出**：
   - 僅回傳 JSON 內的有效 Python 程式碼。

${STRATEGY_GUIDE_AI}
`;

const SYSTEM_INSTRUCTION = `
你是專精於台指期（TXF）高頻交易的量化開發者。
你的目標是依照使用者需求與行情脈絡產生 Python 策略程式碼。
請一律回傳 JSON 格式。
所有自然語言說明必須使用繁體中文。
`;

const cleanJson = (text: string) => {
    // 移除可能存在的 Markdown code block
    let cleaned = text.replace(/```json/g, '').replace(/```/g, '');
    return cleaned.trim();
};

const callAiBackend = async (prompt: string): Promise<string> => {
  const config = await getAppConfig();
  const res = await fetch(`${config.apiBase}/api/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system: SYSTEM_INSTRUCTION,
      prompt
    })
  });

  if (!res.ok) {
    const message = await res.text();
    throw new Error(message || `AI 請求失敗 (${res.status})`);
  }

  const data = (await res.json()) as { content?: string };
  const content = data.content || '';
  if (!content) throw new Error('AI 回應內容為空');
  return content;
};

export const generateStrategy = async (
  prompt: string, 
  marketContext: Candle[]
): Promise<{ code: string; explanation: string; name: string }> => {
  try {
    // 摘要行情以節省字數
    const recentClose = marketContext.slice(-10).map(c => c.close).join(', ');
    const contextStr = `最近 10 根 1 分 K 收盤價: [${recentClose}]，目前波動偏高。`;

    const fullPrompt = `
      ${STRATEGY_INTERFACE_CONTEXT}

      行情摘要: ${contextStr}
      使用者需求: ${prompt}
      
      任務：為需求建立一個穩健的 Python HFT 策略程式碼。
      
      請嚴格輸出 JSON：
      {
        "name": "策略名稱（繁體中文）",
        "explanation": "策略邏輯簡述（繁體中文）",
        "code": "完整 Python 程式碼"
      }
    `;

    const text = await callAiBackend(fullPrompt);
    return JSON.parse(cleanJson(text));

  } catch (error) {
    console.error('Ollama API Error:', error);
    return {
      name: '錯誤',
      explanation: '無法生成策略，請檢查 Ollama 服務是否啟動。',
      code: '# Error generating code'
    };
  }
};

export const improveStrategy = async (
  currentStrategy: Strategy,
  performanceMetric: string
): Promise<{ code: string; improvements: string }> => {
    try {
        const prompt = `
            ${STRATEGY_INTERFACE_CONTEXT}

            你是量化交易專家。
            
            現在的策略程式碼：
            ${currentStrategy.code}

            回測結果：
            ${performanceMetric}

            任務：分析回測結果。
            - 若績效不佳（負報酬或高回撤），請提出顯著的邏輯調整（如停損、改指標、反向邏輯）。
            - 若績效不錯，請微調以提升獲利因子或勝率。
            
            **請依規範輸出完整 Python 程式碼**。
            
            回傳 JSON：
            {
                "code": "完整修改後的 Python 程式碼",
                "improvements": "變更摘要（繁體中文）"
            }
        `;

        const text = await callAiBackend(prompt);
        return JSON.parse(cleanJson(text));
    } catch (e) {
        console.error(e);
        return { code: currentStrategy.code, improvements: '進化失敗。' };
    }
}

export const refineStrategy = async (
  currentCode: string,
  userInstruction: string
): Promise<{ code: string; changes: string }> => {
    try {
        const prompt = `
            ${STRATEGY_INTERFACE_CONTEXT}

            目前的 Python 策略程式碼：
            ${currentCode}

            使用者修改指令：
            ${userInstruction}

            任務：依使用者指令修改策略程式碼，並維持規範一致性。
            
            回傳 JSON：
            {
                "code": "完整修改後的 Python 程式碼",
                "changes": "變更摘要（繁體中文）"
            }
        `;

        const text = await callAiBackend(prompt);
        return JSON.parse(cleanJson(text));
    } catch (e) {
        console.error(e);
        return { code: currentCode, changes: '修改失敗: ' + (e as Error).message };
    }
}

export const optimizeStrategyParameters = async (
  strategy: Strategy
): Promise<{ newParameters: Record<string, any>; reasoning: string }> => {
    try {
        const prompt = `
            ${STRATEGY_INTERFACE_CONTEXT}

            目前的策略程式碼：
            ${strategy.code}

            現在的參數：
            ${JSON.stringify(strategy.parameters)}

            任務：分析策略邏輯，建議一組優化後的參數，以提升 1 分 K 高波動市場的表現。
            參數名稱需保持一致，只調整數值。
            
            回傳 JSON：
            {
                "newParameters": { "key": value, ... },
                "reasoning": "調整原因（繁體中文）"
            }
        `;

        const text = await callAiBackend(prompt);
        return JSON.parse(cleanJson(text));
    } catch (e) {
        console.error(e);
        return { newParameters: strategy.parameters, reasoning: '參數優化失敗' };
    }
}

// --- RL 代理人生成與進化 ---

export const generateRLAgent = async (
    userPrompt: string
): Promise<{ config: RLConfig; envCode: string; explanation: string; name: string }> => {
    try {
        const prompt = `
            你是金融交易的深度強化學習（DQN）專家。
            
            使用者需求："${userPrompt}"
            
            任務 1：建議 DQN 超參數（RLConfig）。
            任務 2：撰寫名為 \`CustomTradingEnv\` 的自訂環境類別，依需求定義狀態特徵。

            \`CustomTradingEnv\` 規則：
            1. 必須有 \`__init__(self, candles_data)\`。
               - \`candles_data\` 格式：[{ 'open':.., 'close':.., 'high':.., 'low':.., 'volume':.., 'orderBook':{...}}, ...]
               - 轉為 DataFrame \`self.df\`。
               - 在此計算指標（RSI、MACD、布林等）。
            2. 必須有 \`reset(self)\`。
               - 重設步數與持倉，回傳 \`self.get_state()\`。
            3. 必須有 \`step(self, action)\`。
               - action: 0=Hold, 1=Buy, 2=Sell。
               - 回傳 \`next_state, reward, done\`。
               - 自行計算 Reward（PnL），並進行縮放（如 reward/1000）。
            4. 必須有 \`get_state(self)\`。
               - 必須回傳浮點數陣列。
               - 需正規化特徵（如 RSI/100、(Price-SMA)/Price）。
               - 不可回傳離散 tuple。
            
            輸出 JSON：
            {
                "name": "代理人名稱",
                "explanation": "特徵與獎勵設計說明（繁體中文）",
                "config": {
                    "episodes": number,
                    "learningRate": number,
                    "discountFactor": number,
                    "epsilonDecay": number,
                    "batchSize": number,
                    "hiddenLayerSize": number
                },
                "envCode": "CustomTradingEnv 完整 Python 程式碼"
            }
        `;

        const text = await callAiBackend(prompt);
        return JSON.parse(cleanJson(text));

    } catch (e) {
        console.error(e);
        return {
            name: 'Default DQN Agent',
            explanation: '生成失敗，使用預設設定。',
            config: { episodes: 100, learningRate: 0.001, discountFactor: 0.95, epsilonDecay: 0.99, batchSize: 32, hiddenLayerSize: 24 },
            envCode: ''
        };
    }
};

export const evolveRLConfig = async (
    currentConfig: RLConfig,
    history: RLTrainingStep[]
): Promise<{ config: RLConfig; reasoning: string }> => {
    try {
        // 彙整歷史訓練資訊
        const start = history[0];
        const end = history[history.length - 1];
        const avgReward = history.reduce((sum, h) => sum + h.totalReward, 0) / history.length;
        
        const historySummary = `
            起始 Episode: Reward=${start?.totalReward}, WinRate=${start?.winRate}
            結束 Episode: Reward=${end?.totalReward}, WinRate=${end?.winRate}
            平均 Reward: ${avgReward}
            趨勢: ${end?.totalReward > start?.totalReward ? '改善中' : '停滯/下降'}
        `;

        const prompt = `
            你正在優化 DQN 交易代理人。
            
            目前設定：${JSON.stringify(currentConfig)}
            訓練摘要：${historySummary}
            
            任務：分析訓練結果。
            - 若結果不穩定，可降低 learning rate 或提高 batch size。
            - 若學習停滯，可提高 hiddenLayerSize 或調整 discount factor。
            
            請提出新的設定以改善收斂與獲利。
            
            輸出 JSON：
            {
                "config": {
                    "episodes": number,
                    "learningRate": number,
                    "discountFactor": number,
                    "epsilonDecay": number,
                    "batchSize": number,
                    "hiddenLayerSize": number
                },
                "reasoning": "分析與調整理由（繁體中文）"
            }
        `;

        const text = await callAiBackend(prompt);
        return JSON.parse(cleanJson(text));

    } catch (e) {
        console.error(e);
        return { config: currentConfig, reasoning: '優化失敗' };
    }
};

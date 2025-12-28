import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Activity, Terminal, Cpu, Zap, TrendingUp, Code, History, BarChart2, MousePointer2, List, Edit3, FlaskConical, Timer, Loader2, BrainCircuit, BookOpen, Save, RotateCcw, Database, Settings, Cloud, Layers, LayoutGrid, ChevronsUp, Minimize2 } from 'lucide-react';
import { MarketChart, EquityChart } from './components/Chart';
import { generateInitialData, generateHistoricalData, CandleMeta } from './services/marketData';
import { generateStrategy, improveStrategy, refineStrategy, generateRLAgent, evolveRLConfig } from './services/geminiService';
import { initPyodide, trainRLAgent } from './services/pythonEngine';
import { api } from './services/api';
import { getAppConfig } from './services/configService';
import { BacktestRun, Candle, TaskStatus, Trade, AppMode, Strategy, SimulationState, OptimizationMethod, OptimizationTarget, CostConfig, WalkForwardConfig, RLConfig, RLTrainingStep, SystemSettings, LayoutsConfig, WidgetSizesConfig, WidgetLayoutsConfig, WidgetMinimizedConfig, WidgetId, WidgetState, UserProfile, MarketFeedSource, MarketFeedStatus, AppConfig, MarketScope, StrategyTemplate } from './types';
import { DEFAULT_COSTS, processTradeLogic } from './services/tradeUtils';
import { useBacktestSystem } from './hooks/useBacktestSystem';
import { WidgetFrame } from './components/WidgetFrame';
import { 
    BacktestRunsWidget, ConfigEditorWidget, ManualTradeWidget, RecentTradesWidget, StrategyManagerWidget, 
    BacktestLabWidget, DataManagementWidget, PerfStatsWidget, OrderFlowWidget, RLTrainingWidget, TaskMonitorWidget
} from './components/DashboardWidgets';
import { DocumentationWidget } from './components/DocumentationWidget';
import { SimulatedMarketFeed } from './services/marketFeed';

const EMPTY_PERFORMANCE = {
  totalReturn: 0,
  netProfit: 0,
  maxDrawdown: 0,
  winRate: 0,
  profitFactor: 0,
  payoffRatio: 0,
  totalTrades: 0,
  avgTrade: 0,
  sqn: 0,
  totalTax: 0,
  totalCommission: 0,
  totalSlippage: 0
};

const normalizeStrategy = (strategy: Strategy): Strategy => {
  const performance = { ...EMPTY_PERFORMANCE, ...(strategy.performance || {}) };
  const parameters = strategy.parameters || {};

  return {
    ...strategy,
    type: strategy.type || 'Standard',
    performance,
    parameters,
    version: strategy.version || 1
  };
};

const buildStrategyBase = (overrides: Partial<Strategy>): Strategy => {
  const performance = { ...EMPTY_PERFORMANCE, ...(overrides.performance || {}) };
  const parameters = overrides.parameters || {};

  return {
    id: overrides.id || `STRAT-${Date.now()}`,
    type: overrides.type || 'Standard',
    name: overrides.name || '未命名策略',
    description: overrides.description || '',
    code: overrides.code || '',
    performance,
    parameters,
    version: overrides.version ?? 1,
    isIntraday: overrides.isIntraday ?? true,
    isEnabled: overrides.isEnabled ?? false,
    rlConfig: overrides.rlConfig,
    rlEnvCode: overrides.rlEnvCode
  };
};

const PLACEHOLDER_STRATEGY = buildStrategyBase({
  id: 'STRAT-LOADING',
  name: '載入中',
  description: '策略載入中。',
  code: "# 讀取策略中...\n+def on_tick(candles, ctx):\n+    return",
  isEnabled: false
});

const DEFAULT_LAYOUTS: LayoutsConfig = {
  [AppMode.BACKTEST]: ['backtestControls', 'marketChart', 'orderFlow', 'strategyManager', 'backtestLab', 'perfStats', 'backtestRuns', 'configEditor', 'recentTrades', 'equityCurve', 'manualTrade'],
  [AppMode.AI_LAB]: ['codeEditor', 'strategyManager', 'aiControls', 'systemLog'],
  [AppMode.RL_AGENT]: ['rlTraining', 'strategyManager', 'systemLog', 'codeEditor'],
  [AppMode.DOCS]: []
};

const DEFAULT_WIDGET_SIZES: WidgetSizesConfig = {
  marketChart: { colSpan: 8, heightPx: 664 },
  orderFlow: { colSpan: 8, heightPx: 317 },
  strategyManager: { colSpan: 4, heightPx: 660 },
  backtestLab: { colSpan: 8, heightPx: 520 },
  manualTrade: { colSpan: 4, heightPx: 317 },
  recentTrades: { colSpan: 12, heightPx: 300 },
  systemLog: { colSpan: 4, heightPx: 646 },
  taskMonitor: { colSpan: 4, heightPx: 273 },
  backtestControls: { colSpan: 12, heightPx: 220 },
  backtestRuns: { colSpan: 4, heightPx: 320 },
  configEditor: { colSpan: 4, heightPx: 320 },
  perfStats: { colSpan: 4, heightPx: 320 },
  equityCurve: { colSpan: 8, heightPx: 320 },
  codeEditor: { colSpan: 8, heightPx: 659 },
  aiControls: { colSpan: 4, heightPx: 244 },
  rlTraining: { colSpan: 8, heightPx: 657 }
};

const BASE_WIDGET_LAYOUTS: WidgetLayoutsConfig = {
  [AppMode.BACKTEST]: {
    backtestControls: { x: 16, y: 16, widthPx: 760, heightPx: 220 },
    marketChart: { x: 16, y: 252, widthPx: 760, heightPx: 420 },
    perfStats: { x: 796, y: 16, widthPx: 360, heightPx: 220 },
    backtestRuns: { x: 796, y: 252, widthPx: 360, heightPx: 300 },
    equityCurve: { x: 16, y: 688, widthPx: 760, heightPx: 300 },
    strategyManager: { x: 796, y: 568, widthPx: 360, heightPx: 520 },
    configEditor: { x: 16, y: 1004, widthPx: 760, heightPx: 300 },
    recentTrades: { x: 16, y: 1320, widthPx: 1140, heightPx: 260 },
    orderFlow: { x: 796, y: 1104, widthPx: 360, heightPx: 300 },
    manualTrade: { x: 796, y: 1420, widthPx: 360, heightPx: 300 },
    backtestLab: { x: 16, y: 1600, widthPx: 760, heightPx: 520 }
  },
  [AppMode.AI_LAB]: {
    codeEditor: { x: 16, y: 16, widthPx: 760, heightPx: 660 },
    aiControls: { x: 796, y: 16, widthPx: 360, heightPx: 244 },
    strategyManager: { x: 796, y: 276, widthPx: 360, heightPx: 520 },
    systemLog: { x: 16, y: 692, widthPx: 1140, heightPx: 300 }
  },
  [AppMode.RL_AGENT]: {
    rlTraining: { x: 16, y: 16, widthPx: 760, heightPx: 660 },
    strategyManager: { x: 796, y: 16, widthPx: 360, heightPx: 520 },
    codeEditor: { x: 16, y: 692, widthPx: 1140, heightPx: 300 },
    systemLog: { x: 796, y: 552, widthPx: 360, heightPx: 440 }
  },
  [AppMode.DOCS]: {}
};

const buildCascadeDefaults = (layouts: LayoutsConfig, baseLayouts: WidgetLayoutsConfig): WidgetLayoutsConfig => {
  const startX = 16;
  const startY = 16;
  const step = 28;
  const result: WidgetLayoutsConfig = {};
  (Object.values(AppMode) as AppMode[]).forEach((mode) => {
    const ids = layouts[mode] || [];
    let index = 0;
    const modeLayout: Partial<Record<WidgetId, WidgetPosition>> = {};
    ids.forEach((id) => {
      const base = baseLayouts[mode]?.[id] || baseLayouts[AppMode.BACKTEST]?.[id];
      if (!base) return;
      modeLayout[id] = {
        ...base,
        x: startX + index * step,
        y: startY + index * step
      };
      index += 1;
    });
    result[mode] = modeLayout;
  });
  return result;
};

const DEFAULT_WIDGET_LAYOUTS: WidgetLayoutsConfig = buildCascadeDefaults(DEFAULT_LAYOUTS, BASE_WIDGET_LAYOUTS);

const mergeLayouts = (incoming?: LayoutsConfig): LayoutsConfig => ({
  ...DEFAULT_LAYOUTS,
  ...(incoming || {})
});

const mergeWidgetSizes = (incoming?: WidgetSizesConfig): WidgetSizesConfig => ({
  ...DEFAULT_WIDGET_SIZES,
  ...(incoming || {})
});

const mergeWidgetLayouts = (incoming?: WidgetLayoutsConfig): WidgetLayoutsConfig => ({
  ...DEFAULT_WIDGET_LAYOUTS,
  ...(incoming || {})
});

const buildDefaultMinimized = (layouts: LayoutsConfig): WidgetMinimizedConfig => {
  return (Object.values(AppMode) as AppMode[]).reduce((acc, mode) => {
    const ids = layouts[mode] || [];
    const modeState: Partial<Record<WidgetId, boolean>> = {};
    ids.forEach((id) => {
      modeState[id] = true;
    });
    acc[mode] = modeState;
    return acc;
  }, {} as WidgetMinimizedConfig);
};

const DEFAULT_WIDGET_MINIMIZED = buildDefaultMinimized(DEFAULT_LAYOUTS);
if (DEFAULT_WIDGET_MINIMIZED[AppMode.BACKTEST]) {
  DEFAULT_WIDGET_MINIMIZED[AppMode.BACKTEST].backtestLab = false;
}
if (DEFAULT_WIDGET_MINIMIZED[AppMode.RL_AGENT]) {
  DEFAULT_WIDGET_MINIMIZED[AppMode.RL_AGENT].rlTraining = false;
}

const mergeWidgetMinimized = (incoming?: WidgetMinimizedConfig): WidgetMinimizedConfig => {
  const base = DEFAULT_WIDGET_MINIMIZED;
  const result: WidgetMinimizedConfig = { ...base };
  (Object.values(AppMode) as AppMode[]).forEach((mode) => {
    result[mode] = { ...(base[mode] || {}), ...(incoming?.[mode] || {}) };
  });
  return result;
};

const DEFAULT_SETTINGS: SystemSettings = {
  costConfig: DEFAULT_COSTS,
  wfoConfig: { trainWindowDays: 14, testWindowDays: 7 },
  isWfoEnabled: false,
  optMethod: 'GRID',
  optTarget: 'NET_PROFIT',
  autoOptimize: false,
  marketScope: {
    symbol: 'TXF',
    frequency: '1m',
    timezone: 'Asia/Taipei',
    exchange: 'TAIFEX'
  },
  layouts: DEFAULT_LAYOUTS,
  widgetSizes: DEFAULT_WIDGET_SIZES,
  widgetLayout: DEFAULT_WIDGET_LAYOUTS,
  widgetMinimized: DEFAULT_WIDGET_MINIMIZED
};

const buildDefaultOrder = (layouts: LayoutsConfig): Record<AppMode, WidgetId[]> => {
  return (Object.values(AppMode) as AppMode[]).reduce((acc, mode) => {
    acc[mode] = [...(layouts[mode] || [])];
    return acc;
  }, {} as Record<AppMode, WidgetId[]>);
};

const buildMarketMeta = (config: AppConfig | null): CandleMeta => ({
  symbol: config?.backtest?.benchmark || 'TXF',
  frequency: config?.data?.defaultFrequency || '1m',
  timezone: config?.data?.timezone || 'Asia/Taipei',
  exchange: config?.data?.calendar || 'TWSE'
});

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

const STRATEGY_HIGHLIGHT_STYLE = {
  string: 'color: rgb(253, 164, 175);',
  comment: 'color: rgb(148, 163, 184);',
  number: 'color: rgb(251, 191, 36);',
  keyword: 'color: rgb(125, 211, 252); font-weight: 600;'
};

const highlightPython = (code: string) => {
  const tokens = /(\"\"\"[\s\S]*?\"\"\"|'''[\s\S]*?'''|\"[^\"\\]*(?:\\.[^\"\\]*)*\"|'[^'\\]*(?:\\.[^'\\]*)*'|#.*$)/gm;
  const keywords = [
    'class','def','return','if','elif','else','for','while','in','and','or','not',
    'import','from','as','try','except','finally','with','lambda','True','False','None',
    'break','continue','pass','raise','yield'
  ].join('|');

  const highlightPlain = (text: string) => {
    let html = escapeHtml(text);
    html = html.replace(/\b(\d+(?:\.\d+)?)\b/g, `<span style="${STRATEGY_HIGHLIGHT_STYLE.number}">$1</span>`);
    html = html.replace(new RegExp(`\\b(${keywords})\\b`, 'g'), `<span style="${STRATEGY_HIGHLIGHT_STYLE.keyword}">$1</span>`);
    return html;
  };

  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = tokens.exec(code)) !== null) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      result += highlightPlain(code.slice(lastIndex, index));
    }
    const token = match[0];
    const escapedToken = escapeHtml(token);
    if (token.startsWith('#')) {
      result += `<span style="${STRATEGY_HIGHLIGHT_STYLE.comment}">${escapedToken}</span>`;
    } else {
      result += `<span style="${STRATEGY_HIGHLIGHT_STYLE.string}">${escapedToken}</span>`;
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < code.length) {
    result += highlightPlain(code.slice(lastIndex));
  }

  return result;
};

export default function App() {
  // -- Global State --
  const [data, setData] = useState<Candle[]>([]);
  const [activeMode, setActiveMode] = useState<AppMode>(AppMode.BACKTEST);
  const [lastNonDocsMode, setLastNonDocsMode] = useState<AppMode>(AppMode.BACKTEST);
  const [backtestTrades, setBacktestTrades] = useState<Trade[]>([]);
  const [executionTrades, setExecutionTrades] = useState<Trade[]>([]);
  const [currentPosition, setCurrentPosition] = useState<{size: number, avgPrice: number}>({ size: 0, avgPrice: 0 });
  const [equityCurve, setEquityCurve] = useState<{time: string, equity: number}[]>([]);
  const [researchTrades, setResearchTrades] = useState<Trade[]>([]);
  const [researchEquityCurve, setResearchEquityCurve] = useState<{time: string, equity: number}[]>([]);
  const [researchPerformance, setResearchPerformance] = useState(EMPTY_PERFORMANCE);
  const [researchIntradayEnabled, setResearchIntradayEnabled] = useState(false);
  const [isPythonReady, setIsPythonReady] = useState(false);
  const [costConfig, setCostConfig] = useState<CostConfig>(DEFAULT_SETTINGS.costConfig);
  
  // Strategy State
  const [strategies, setStrategies] = useState<Strategy[]>([PLACEHOLDER_STRATEGY]);
  const [activeStrategyId, setActiveStrategyId] = useState<string>(PLACEHOLDER_STRATEGY.id);
  const [activeStrategyTab, setActiveStrategyTab] = useState<'Standard' | 'RL'>('Standard'); // Lifted State
  const [researchStrategyId, setResearchStrategyId] = useState<string>('');
  const [backtestRuns, setBacktestRuns] = useState<BacktestRun[]>([]);
  const [configWarnings, setConfigWarnings] = useState<string[]>([]);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authUsername, setAuthUsername] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [configText, setConfigText] = useState<string>('');
  const [configStatus, setConfigStatus] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TaskStatus[]>([]);

  const [evolutionLog, setEvolutionLog] = useState<string[]>([]);
  const [initialCapital, setInitialCapital] = useState(5000000);
  const [simState, setSimState] = useState<SimulationState>({ balance: 5000000, equity: 5000000, dayPnL: 0 });

  // -- UI State --
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [loadDays, setLoadDays] = useState<number>(30);
  const [intradayMode, setIntradayMode] = useState<'BLOCK_AFTER_CLOSE' | 'FORCE_CLOSE_AT_TIME'>('BLOCK_AFTER_CLOSE');
  const [intradayForceCloseTime, setIntradayForceCloseTime] = useState<string>('13:41');
  const [backtestStartDate, setBacktestStartDate] = useState<string>(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().split('T')[0];
  });
  const [backtestEndDate, setBacktestEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [isGeneratingData, setIsGeneratingData] = useState(false);
  const [manualOrderSize, setManualOrderSize] = useState(1);
  const [aiPrompt, setAiPrompt] = useState('');
  const [modificationPrompt, setModificationPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [showNewStrategyInput, setShowNewStrategyInput] = useState(false);
  const [showOptSettings, setShowOptSettings] = useState(false);
  const [optMethod, setOptMethod] = useState<OptimizationMethod>(DEFAULT_SETTINGS.optMethod);
  const [optTarget, setOptTarget] = useState<OptimizationTarget>(DEFAULT_SETTINGS.optTarget);
  const [autoOptimize, setAutoOptimize] = useState(DEFAULT_SETTINGS.autoOptimize);
  const [aiProgress, setAiProgress] = useState(0);
  const [currentAiTask, setCurrentAiTask] = useState<string | null>(null);

  const [marketSource, setMarketSource] = useState<MarketFeedSource>('SIMULATED');
  const [marketStatus, setMarketStatus] = useState<MarketFeedStatus>({ state: 'IDLE', source: 'SIMULATED' });
  const [marketStatusAt, setMarketStatusAt] = useState<string>('');
  const [marketScope, setMarketScope] = useState<MarketScope>(buildMarketMeta(null));
  const [strategyTemplates, setStrategyTemplates] = useState<StrategyTemplate[]>([]);
  const marketFeedRef = useRef<SimulatedMarketFeed | null>(null);
  const marketMetaRef = useRef<CandleMeta>(buildMarketMeta(null));
  const marketUnsubsRef = useRef<Array<() => void>>([]);
  
  // WFO State
  const [isWfoEnabled, setIsWfoEnabled] = useState(DEFAULT_SETTINGS.isWfoEnabled);
  const [wfoConfig, setWfoConfig] = useState<WalkForwardConfig>(DEFAULT_SETTINGS.wfoConfig);
  const [settingsReady, setSettingsReady] = useState(false);
  const settingsSaveTimer = useRef<number | null>(null);

  // RL State (Global state is fallback, mostly uses activeStrategy.rlConfig)
  // Updated with DQN defaults
  const [rlConfig, setRlConfig] = useState<RLConfig>({ 
      episodes: 100, 
      learningRate: 0.001, 
      discountFactor: 0.95, 
      epsilonDecay: 0.99,
      batchSize: 32,
      hiddenLayerSize: 24
  });
  const [rlHistory, setRlHistory] = useState<RLTrainingStep[]>([]);
  const [isRlTraining, setIsRlTraining] = useState(false);
  const [generatedRlCode, setGeneratedRlCode] = useState<string | null>(null);
  const [rlProgress, setRlProgress] = useState(0);
  const [codeDraft, setCodeDraft] = useState<string>('');
  const [codeSaveStatus, setCodeSaveStatus] = useState<'idle' | 'dirty' | 'saving' | 'saved'>('idle');
  const codeSaveTimerRef = useRef<number | null>(null);
  const pendingStrategiesRef = useRef<Strategy[] | null>(null);
  const codeEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const codePreviewRef = useRef<HTMLPreElement | null>(null);

  const activeStrategy = strategies.find(s => s.id === activeStrategyId) || strategies[0];
  const researchStrategy = strategies.find(s => s.id === researchStrategyId) || strategies[0];
  const editorStrategy = researchStrategy;
  const rlTargetStrategy = researchStrategy;
  const aiTargetStrategy = researchStrategy;
  const autoBacktestRef = useRef<string | null>(null);

  // Sync Global RL Config State with Active Strategy
  useEffect(() => {
    if (rlTargetStrategy.type === 'RL' && rlTargetStrategy.rlConfig) {
        setRlConfig(rlTargetStrategy.rlConfig);
    }
  }, [rlTargetStrategy]); // Re-run when strategy changes

  useEffect(() => {
    if (strategies.length === 0) return;
    const current = strategies.find(s => s.id === researchStrategyId);
    if (current) return;
    const fallback = strategies.find(s => s.id === activeStrategyId)
      || strategies.find(s => s.id !== PLACEHOLDER_STRATEGY.id)
      || strategies[0];
    if (fallback) setResearchStrategyId(fallback.id);
  }, [strategies, researchStrategyId, activeStrategyId]);

  useEffect(() => {
    setResearchPerformance(EMPTY_PERFORMANCE);
    setResearchTrades([]);
    setResearchEquityCurve([]);
  }, [researchStrategyId]);

  useEffect(() => {
    autoBacktestRef.current = null;
    setBacktestTrades([]);
    setEquityCurve([]);
  }, [activeStrategyId]);

  useEffect(() => {
    if (!researchStrategy) return;
    setResearchIntradayEnabled(!!researchStrategy.isIntraday);
  }, [researchStrategyId, researchStrategy]);

  useEffect(() => {
    setCodeDraft(editorStrategy.code || '');
    setCodeSaveStatus('idle');
  }, [editorStrategy.id, editorStrategy.code]);

  useEffect(() => {
    if (!generatedRlCode) return;
    if (editorStrategy.type !== 'RL') return;
    setCodeDraft(generatedRlCode);
  }, [generatedRlCode, editorStrategy.type]);

  useEffect(() => {
    if (!marketStatus.state) return;
    setMarketStatusAt(new Date().toISOString());
  }, [marketStatus.state, marketStatus.source]);

  useEffect(() => {
    marketMetaRef.current = marketScope;
  }, [marketScope]);

  useEffect(() => {
    const handler = (event: Event) => {
      const warnings = (event as CustomEvent<string[]>).detail || [];
      if (warnings.length === 0) return;
      setConfigWarnings(warnings);
      setEvolutionLog(prev => [
        ...warnings.map((msg) => `?? ${msg}`),
        ...prev
      ]);
    };
    window.addEventListener('config:warning', handler as EventListener);
    return () => window.removeEventListener('config:warning', handler as EventListener);
  }, []);

  // -- Hooks --
  const handleBacktestSaved = useCallback((run: BacktestRun) => {
    setBacktestRuns(prev => [run, ...prev].slice(0, 50));
  }, []);

  const loadConfigEditor = useCallback(async () => {
    const cfg = await api.fetchConfig();
    if (!cfg) return;
    setConfigText(JSON.stringify(cfg, null, 2));
  }, []);

  const updateAppConfig = useCallback(async (updater: (cfg: any) => any, successMessage: string) => {
      const current = await api.fetchConfig();
      if (!current) {
          setConfigStatus("設定讀取失敗，無法更新。");
          return;
      }
      const next = updater(current);
      const result = await api.saveConfig(next);
      setConfigText(JSON.stringify(next, null, 2));
      if (result?.warning) {
          setConfigStatus(result.warning);
      } else {
          setConfigStatus(successMessage);
      }
  }, []);

  const backtestSystem = useBacktestSystem({
      data,
      backtestStartDate,
      backtestEndDate,
      intradayMode,
      intradayForceCloseTime,
      activeStrategy,
      isPythonReady,
      setStrategies,
      setTrades: setBacktestTrades,
      setEquityCurve,
      setEvolutionLog,
      costConfig,
      onBacktestSaved: handleBacktestSaved,
      useBacktestRange: false
  });

  const researchBacktestSystem = useBacktestSystem({
      data,
      backtestStartDate,
      backtestEndDate,
      intradayMode,
      intradayForceCloseTime,
      intradayEnabledOverride: researchIntradayEnabled,
      activeStrategy: researchStrategy,
      isPythonReady,
      setStrategies,
      setTrades: setResearchTrades,
      setEquityCurve: setResearchEquityCurve,
      setEvolutionLog,
      costConfig,
      onBacktestSaved: handleBacktestSaved,
      updateStrategyPerformance: false,
      onPerformanceUpdate: setResearchPerformance
  });

  const handleOpenBacktestRuns = useCallback(() => {
      setActiveMode(AppMode.BACKTEST);
      setWidgetMinimized(prev => {
          const modeMap = { ...(prev[AppMode.BACKTEST] || {}) };
          modeMap.backtestRuns = false;
          return { ...prev, [AppMode.BACKTEST]: modeMap };
      });
      setWidgetOrder(prev => {
          const current = prev[AppMode.BACKTEST] || [];
          const next = [...current.filter((wid) => wid !== 'backtestRuns'), 'backtestRuns'];
          return { ...prev, [AppMode.BACKTEST]: next };
      });
      setMaximizedWidget(null);
  }, []);

  // -- Initializers --
  const loadUserData = useCallback(async () => {
      // 1. Python Engine (Runs in Browser via WebAssembly)
      try {
        setEvolutionLog(prev => ["正在載入 Python 核心 (Pyodide)...", ...prev]);
        await initPyodide();
        setIsPythonReady(true);
        setEvolutionLog(prev => ["? Python 運算引擎就緒", ...prev]);
      } catch(e) {
        setEvolutionLog(prev => ["Python 環境初始化失敗。", ...prev]);
      }

      const appConfig = await getAppConfig();
      const marketMeta = buildMarketMeta(appConfig);
      marketMetaRef.current = marketMeta;
      setMarketScope(marketMeta);
      const loadDaysFromConfig = appConfig?.data?.loadDays || 30;
      setLoadDays(loadDaysFromConfig);
      if (appConfig?.backtest?.intraday?.mode === 'BLOCK_AFTER_CLOSE' || appConfig?.backtest?.intraday?.mode === 'FORCE_CLOSE_AT_TIME') {
        setIntradayMode(appConfig.backtest.intraday.mode);
      }
      if (typeof appConfig?.backtest?.intraday?.forceCloseTime === 'string') {
        setIntradayForceCloseTime(appConfig.backtest.intraday.forceCloseTime);
      }
      if (appConfig?.backtest?.initialCapital) {
        const capital = appConfig.backtest.initialCapital;
        setInitialCapital(capital);
        setSimState({ balance: capital, equity: capital, dayPnL: 0 });
      }
      
      // 2. Load Settings + Data from Backend
      try {
          setEvolutionLog(prev => ["正在連線後台服務...", ...prev]);
          
          const [remoteSettings, remoteCandles, remoteStrategies, remoteBacktests] = await Promise.all([
              api.fetchSettings(),
              api.fetchCandles(marketMeta, loadDaysFromConfig),
              api.fetchStrategies(),
              api.fetchBacktests()
          ]);

          if (remoteSettings) {
              const resolvedScope = remoteSettings.marketScope || marketMeta;
              const mergedMinimized = mergeWidgetMinimized(remoteSettings.widgetMinimized);
              if (mergedMinimized[AppMode.BACKTEST]?.backtestLab === undefined) {
                  mergedMinimized[AppMode.BACKTEST] = { ...(mergedMinimized[AppMode.BACKTEST] || {}), backtestLab: false };
              }
              if (mergedMinimized[AppMode.RL_AGENT]?.rlTraining === undefined) {
                  mergedMinimized[AppMode.RL_AGENT] = { ...(mergedMinimized[AppMode.RL_AGENT] || {}), rlTraining: false };
              }

              const merged: SystemSettings = {
                  ...DEFAULT_SETTINGS,
                  ...remoteSettings,
                  costConfig: { ...DEFAULT_SETTINGS.costConfig, ...remoteSettings.costConfig },
                  wfoConfig: { ...DEFAULT_SETTINGS.wfoConfig, ...remoteSettings.wfoConfig },
                  marketScope: resolvedScope,
                  layouts: mergeLayouts(remoteSettings.layouts),
                  widgetSizes: mergeWidgetSizes(remoteSettings.widgetSizes),
                  widgetLayout: mergeWidgetLayouts(remoteSettings.widgetLayout),
                  widgetMinimized: mergedMinimized
              };
              setCostConfig(merged.costConfig);
              setWfoConfig(merged.wfoConfig);
              setIsWfoEnabled(merged.isWfoEnabled);
              setOptMethod(merged.optMethod);
              setOptTarget(merged.optTarget);
              setAutoOptimize(merged.autoOptimize);
              if (merged.marketScope) setMarketScope(merged.marketScope);
              setLayouts(merged.layouts);
              setWidgetSizes(merged.widgetSizes);
              setWidgetLayout(merged.widgetLayout || DEFAULT_WIDGET_LAYOUTS);
              setWidgetMinimized(merged.widgetMinimized || DEFAULT_WIDGET_MINIMIZED);
              setEvolutionLog(prev => ["? 已載入後台系統設定。", ...prev]);
          } else {
              setEvolutionLog(prev => ["?? 尚無系統設定，使用預設值。", ...prev]);
          }
          setSettingsReady(true);

          setStrategyTemplates(appConfig?.strategyTemplates || []);
          
          if (remoteCandles.length > 0) {
             setData(remoteCandles);
             setEvolutionLog(prev => [`? 已載入 ${remoteCandles.length} 筆 K 線資料。`, ...prev]);
          } else {
             setEvolutionLog(prev => [`?? 尚無資料，建立初始模擬數據...`, ...prev]);
             const initial = generateInitialData(loadDaysFromConfig, marketMeta);
             setData(initial);
             // Auto-save initial data
             api.saveCandles(initial);
          }

          if (remoteStrategies.length > 0) {
              const patchedStrategies = remoteStrategies.map(normalizeStrategy);
              setStrategies(patchedStrategies);
              setActiveStrategyId(patchedStrategies[0].id);
              // Set initial tab based on first strategy
              setActiveStrategyTab(patchedStrategies[0].type || 'Standard');
              setEvolutionLog(prev => [`? 已載入 ${patchedStrategies.length} 個策略。`, ...prev]);
          } else {
               setEvolutionLog(prev => [`?? 無策略存檔，請建立新策略。`, ...prev]);
               setStrategies([PLACEHOLDER_STRATEGY]);
               setActiveStrategyId(PLACEHOLDER_STRATEGY.id);
               setActiveStrategyTab('Standard');
          }

          setBacktestRuns(remoteBacktests);
          if (remoteBacktests.length > 0) {
              setEvolutionLog(prev => [`? 已載入 ${remoteBacktests.length} 筆回測摘要。`, ...prev]);
          }

            await loadConfigEditor();
            await handleRefreshTasks();

      } catch (e) {
          console.error(e);
          setEvolutionLog(prev => ["? 後台連線失敗或資料載入異常", ...prev]);
          setData(generateInitialData(loadDaysFromConfig, marketMeta));
          setSettingsReady(true);
      }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        let currentUser = null;
        if (api.getToken()) {
          currentUser = await api.me();
        }
        if (!currentUser) {
          currentUser = await api.guest();
        }
        setUser(currentUser);
      } catch (e) {
        setEvolutionLog(prev => ["? 使用者驗證失敗，使用訪客模式。", ...prev]);
        const guestUser = await api.guest();
        setUser(guestUser);
      }
      await loadUserData();
    };
    init();
  }, [loadUserData]);

  // -- Handlers --
  const handleTradeLogic = (side: 'BUY' | 'SELL', price: number, size: number, time: string, prefix: string, note?: string) => {
     setCurrentPosition(prev => {
         const { trade, newPos, netPnL } = processTradeLogic(side, price, size, time, prefix, prev, note, costConfig);
         setExecutionTrades(old => [trade, ...old].slice(0, 200));
         setSimState(s => ({ 
             ...s, 
             balance: s.balance + netPnL, 
             equity: s.balance + netPnL + (newPos.size !== 0 ? (price - newPos.avgPrice) * newPos.size * costConfig.POINT_VALUE : 0),
             dayPnL: s.dayPnL + netPnL 
         }));
         return newPos;
     });
  };

  const handleManualTrade = (side: 'BUY' | 'SELL') => {
      if (data.length === 0) return;
      const last = data[data.length - 1];
      handleTradeLogic(side, last.close, manualOrderSize, last.time, 'MAN');
  };

  const handleGenerateHistory = useCallback(async () => {
    setIsGeneratingData(true);
    setEvolutionLog(prev => [`🔄 正在生成模擬資料 (${startDate} ~ ${endDate})...`, ...prev]);
    
    // Defer to allow UI to render spinner
    setTimeout(async () => {
        const newData = generateHistoricalData(startDate, endDate, marketScope);
        
        // Save to Local DB
        const success = await api.saveCandles(newData);
        
        if (success) {
            setData(newData);
            setBacktestTrades([]);
            setExecutionTrades([]);
            setCurrentPosition({ size: 0, avgPrice: 0 });
            setEquityCurve([]);
            setSimState({ balance: initialCapital, equity: initialCapital, dayPnL: 0 });
            if (marketSource === 'SIMULATED' && marketFeedRef.current && !marketFeedRef.current.isRunning()) {
                marketFeedRef.current.updateSeed(newData);
            }
            setEvolutionLog(prev => [`✅ 資料已重置並儲存 (共 ${newData.length} 根 K 線)`, ...prev]);
        } else {
             setEvolutionLog(prev => [`❌ 資料儲存失敗。`, ...prev]);
        }
        setIsGeneratingData(false);
    }, 100);
 }, [startDate, endDate, marketScope]);
 
 const handleClearDB = async () => {
     if(!confirm("確定要清空所有歷史資料嗎？")) return;
     const success = await api.clearCandles(marketScope);
     if(success) {
         setData([]);
         setBacktestTrades([]);
         setExecutionTrades([]);
         setEquityCurve([]);
         setCurrentPosition({ size: 0, avgPrice: 0 });
         setSimState({ balance: initialCapital, equity: initialCapital, dayPnL: 0 });
         if (marketSource === 'SIMULATED' && marketFeedRef.current && !marketFeedRef.current.isRunning()) {
             marketFeedRef.current.updateSeed([]);
         }
         setEvolutionLog(prev => ["🗑️ 資料庫已清空。", ...prev]);
     } else {
         alert("清除失敗");
     }
 };

  const handleAddManualStrategy = useCallback((payload: { name: string; description: string; code: string }) => {
      const newStrat = buildStrategyBase({
          id: `STRAT-${Date.now()}`,
          type: 'Standard',
          name: payload.name,
          description: payload.description,
          code: payload.code,
          version: 1,
          isIntraday: true,
          isEnabled: false
      });
      setStrategies(prev => {
          const updated = [...prev, newStrat];
          api.saveStrategies(updated);
          return updated;
      });
      setActiveStrategyId(newStrat.id);
      setActiveStrategyTab('Standard');
      setActiveMode(AppMode.BACKTEST);
      setEvolutionLog(prev => [`? 已新增策略：${newStrat.name}`, ...prev]);
  }, []);

  const handleUpdateActiveCode = useCallback((nextCode: string) => {
      setGeneratedRlCode(null);
      setCodeDraft(nextCode);
      setCodeSaveStatus('dirty');
      setStrategies(prev => {
          const updated = prev.map(s => s.id === researchStrategyId ? { ...s, code: nextCode } : s);
          pendingStrategiesRef.current = updated;
          return updated;
      });
      if (codeSaveTimerRef.current !== null) {
          window.clearTimeout(codeSaveTimerRef.current);
      }
      codeSaveTimerRef.current = window.setTimeout(() => {
          if (pendingStrategiesRef.current) {
              setCodeSaveStatus('saving');
              api.saveStrategies(pendingStrategiesRef.current)
                  .then((ok) => setCodeSaveStatus(ok ? 'saved' : 'dirty'))
                  .catch(() => setCodeSaveStatus('dirty'));
          }
      }, 600);
  }, [researchStrategyId]);

  const handleManualSaveCode = useCallback(async () => {
      setCodeSaveStatus('saving');
      const ok = await api.saveStrategies(strategies);
      setCodeSaveStatus(ok ? 'saved' : 'dirty');
  }, [strategies]);

  useEffect(() => {
      return () => {
          if (codeSaveTimerRef.current !== null) {
              window.clearTimeout(codeSaveTimerRef.current);
          }
      };
  }, []);

  const handleApplyMarketScope = useCallback(async () => {
      marketMetaRef.current = marketScope;
      const nextCandles = await api.fetchCandles(marketScope, loadDays);
      if (nextCandles.length > 0) {
          setData(nextCandles);
          autoBacktestRef.current = null;
          setBacktestTrades([]);
          setEquityCurve([]);
          setEvolutionLog(prev => [`? 已載入 ${nextCandles.length} 筆指定行情。`, ...prev]);
      } else {
          setData([]);
          setEvolutionLog(prev => ["?? 指定行情範圍無資料。", ...prev]);
      }
  }, [marketScope, loadDays]);

  const handleResetMarketScope = useCallback(async () => {
      const appConfig = await getAppConfig();
      const nextScope = buildMarketMeta(appConfig);
      setMarketScope(nextScope);
      marketMetaRef.current = nextScope;
      const nextCandles = await api.fetchCandles(nextScope, loadDays);
      if (nextCandles.length > 0) {
          setData(nextCandles);
          autoBacktestRef.current = null;
          setBacktestTrades([]);
          setEquityCurve([]);
          setEvolutionLog(prev => [`? 已切回預設行情 (${nextScope.symbol})。`, ...prev]);
      } else {
          setData([]);
          setEvolutionLog(prev => ["?? 預設行情無資料。", ...prev]);
      }
  }, [loadDays]);
 
  const handleRefreshBacktests = useCallback(async () => {
      const runs = await api.fetchBacktests();
      setBacktestRuns(runs);
  }, []);

  const handleRefreshTasks = useCallback(async () => {
      const nextTasks = await api.fetchTasks();
      setTasks(nextTasks);
  }, []);

  const handleClearBacktests = async () => {
      if (!confirm("確定要清空所有回測摘要嗎？")) return;
      const success = await api.clearBacktests();
      if (success) {
          setBacktestRuns([]);
          setEvolutionLog(prev => ["? 回測摘要已清空。", ...prev]);
      } else {
          alert("清除失敗");
      }
  };

  const handleSaveStrategies = async () => {
     setEvolutionLog(prev => [`💾 正在儲存策略...`, ...prev]);
     const success = await api.saveStrategies(strategies);
     if (success) {
         setEvolutionLog(prev => [`✅ 策略儲存完成。`, ...prev]);
     } else {
         setEvolutionLog(prev => [`❌ 策略儲存失敗。`, ...prev]);
     }
  };

  const handleSeedStrategies = async () => {
     if (!confirm("這會清空目前策略並重建內建策略，確定要執行嗎？")) return;
     setEvolutionLog(prev => [`?? 正在重建內建策略...`, ...prev]);
     const seeded = await api.seedStrategies();
     if (seeded.length > 0) {
         const normalized = seeded.map(normalizeStrategy);
         setStrategies(normalized);
         setActiveStrategyId(normalized[0].id);
         setActiveStrategyTab(normalized[0].type || 'Standard');
         setEvolutionLog(prev => [`? 已重建 ${seeded.length} 套內建策略。`, ...prev]);
     } else {
         setEvolutionLog(prev => [`? 重建內建策略失敗或尚未回傳策略。`, ...prev]);
     }
  };

  const handleReloadConfig = async () => {
      await loadConfigEditor();
      setConfigStatus("已重新載入設定檔。");
  };

  const handleSaveConfig = async () => {
      try {
          const parsed = JSON.parse(configText);
          const result = await api.saveConfig(parsed);
          if (result?.warning) {
              setConfigStatus(result.warning);
          } else {
              setConfigStatus("設定已更新。");
          }
      } catch (e: any) {
          setConfigStatus(`設定格式錯誤：${e.message}`);
      }
  };

  const handleUpdateLoadDays = useCallback((nextDays: number) => {
      setLoadDays(nextDays);
      updateAppConfig((cfg) => ({
          ...cfg,
          data: { ...(cfg.data || {}), loadDays: nextDays }
      }), "已更新載入天數設定。");
  }, [updateAppConfig]);

  const handleReloadMarketData = useCallback(async (overrideDays?: number) => {
      if (!settingsReady) return;
      const targetDays = overrideDays ?? loadDays;
      const nextCandles = await api.fetchCandles(marketScope, targetDays);
      setData(nextCandles);
      autoBacktestRef.current = null;
      setBacktestTrades([]);
      setEquityCurve([]);
      if (nextCandles.length > 0) {
          setEvolutionLog(prev => [`🔄 已重新載入最近 ${targetDays} 天行情（${nextCandles.length} 筆）。`, ...prev]);
      } else {
          setEvolutionLog(prev => ["?? 指定載入天數無資料。", ...prev]);
      }
  }, [loadDays, marketScope, settingsReady]);

  const handleUpdateIntradayMode = useCallback((mode: 'BLOCK_AFTER_CLOSE' | 'FORCE_CLOSE_AT_TIME') => {
      setIntradayMode(mode);
      updateAppConfig((cfg) => ({
          ...cfg,
          backtest: {
              ...(cfg.backtest || {}),
              intraday: {
                  ...(cfg.backtest?.intraday || {}),
                  mode
              }
          }
      }), "已更新當沖模式規則。");
  }, [updateAppConfig]);

  const handleUpdateIntradayForceCloseTime = useCallback((timeValue: string) => {
      setIntradayForceCloseTime(timeValue);
      updateAppConfig((cfg) => ({
          ...cfg,
          backtest: {
              ...(cfg.backtest || {}),
              intraday: {
                  ...(cfg.backtest?.intraday || {}),
                  forceCloseTime: timeValue
              }
          }
      }), "已更新當沖平倉時間。");
  }, [updateAppConfig]);

  const ensureAuthToken = async () => {
      if (api.getToken()) return true;
      try {
          const guestUser = await api.guest();
          setUser(guestUser);
          return true;
      } catch {
          return false;
      }
  };

  const handleSaveLayout = async () => {
      const authed = await ensureAuthToken();
      if (!authed) {
          setEvolutionLog(prev => ["❌ 無法取得登入狀態，請確認後端是否啟動。", ...prev]);
          return;
      }
      const nextSettings: SystemSettings = {
          costConfig,
          wfoConfig,
          isWfoEnabled,
          optMethod,
          optTarget,
          autoOptimize,
          marketScope,
          layouts,
          widgetSizes,
          widgetLayout,
          widgetMinimized
      };
      const success = await api.saveSettings(nextSettings);
      setEvolutionLog(prev => [
        success ? "✅ 佈局與尺寸已存檔。" : "❌ 佈局存檔失敗，請確認後端連線。",
        ...prev
      ]);
  };

  const handleResetLayout = async () => {
      if (!confirm("確定要還原預設佈局與尺寸嗎？")) return;
      const authed = await ensureAuthToken();
      if (!authed) {
          setEvolutionLog(prev => ["❌ 無法取得登入狀態，請確認後端是否啟動。", ...prev]);
          return;
      }
      setLayouts(DEFAULT_LAYOUTS);
      setWidgetSizes(DEFAULT_WIDGET_SIZES);
      setWidgetLayout(DEFAULT_WIDGET_LAYOUTS);
      setWidgetMinimized(DEFAULT_WIDGET_MINIMIZED);
      const nextSettings: SystemSettings = {
          costConfig,
          wfoConfig,
          isWfoEnabled,
          optMethod,
          optTarget,
          autoOptimize,
          layouts: DEFAULT_LAYOUTS,
          widgetSizes: DEFAULT_WIDGET_SIZES,
          widgetLayout: DEFAULT_WIDGET_LAYOUTS,
          widgetMinimized: DEFAULT_WIDGET_MINIMIZED
      };
      const success = await api.saveSettings(nextSettings);
      setEvolutionLog(prev => [
        success ? "✅ 已還原預設佈局並存檔。" : "❌ 還原佈局失敗，請確認後端連線。",
        ...prev
      ]);
  };

  const handleResetPositions = () => {
      const mode = activeMode;
      const ids = layouts[mode] || DEFAULT_LAYOUTS[mode] || [];
      setWidgetLayout(prev => {
          const modeLayout = { ...(prev[mode] || {}) };
          ids.forEach((id) => {
              const base = DEFAULT_WIDGET_LAYOUTS[mode]?.[id] || DEFAULT_WIDGET_LAYOUTS[AppMode.BACKTEST]?.[id];
              if (!base) return;
              modeLayout[id] = { ...base };
          });
          return { ...prev, [mode]: modeLayout };
      });
      const dockWidth = dockRef.current?.offsetWidth || (dockCollapsed ? 72 : 140);
      const dockTop = dockCollapsed ? 8 : (getHeaderHeight() + 8);
      const x = Math.max(8, Math.min(window.innerWidth - dockWidth - 8, 8));
      setDockPosition({ x, y: dockTop });
      clampLayoutToViewport(mode);
      setEvolutionLog(prev => [`? 視窗位置已重置到左上角。`, ...prev]);
  };

  const handleAuthSubmit = async () => {
      setAuthError(null);
      try {
          let currentUser: UserProfile;
          if (authMode === 'login') {
              currentUser = await api.login(authUsername, authPassword);
          } else {
              currentUser = await api.register(authUsername, authPassword);
          }
          setUser(currentUser);
          setShowAuthModal(false);
          setAuthUsername('');
          setAuthPassword('');
          await loadUserData();
          setEvolutionLog(prev => [`? 已切換使用者：${currentUser.username}`, ...prev]);
      } catch (e: any) {
          setAuthError(e.message || '登入失敗');
      }
  };

  const handleSwitchGuest = async () => {
      await api.logout();
      const guestUser = await api.guest();
      setUser(guestUser);
      await loadUserData();
      setEvolutionLog(prev => [`? 已切換至訪客模式。`, ...prev]);
  };



  const handleToggleStrategy = (id: string, enabled: boolean) => {
      setStrategies(prev => {
          const updated = prev.map(s => {
              if (s.id === id) return { ...s, isEnabled: enabled };
              return enabled ? { ...s, isEnabled: false } : s;
          });
          api.saveStrategies(updated);
          return updated;
      });
      if (enabled) {
          autoBacktestRef.current = null;
          setActiveStrategyId(id);
          if (activeMode !== AppMode.BACKTEST) setActiveMode(AppMode.BACKTEST);
      } else {
          autoBacktestRef.current = null;
          setBacktestTrades([]);
          setEquityCurve([]);
      }
  };

  const ensureSimulatedFeed = useCallback(() => {
      if (!marketFeedRef.current) {
          const seed = data.length > 0 ? data : generateInitialData(loadDays, marketMetaRef.current);
          marketFeedRef.current = new SimulatedMarketFeed({
              seedCandles: seed,
              intervalMs: 1000,
              maxCandles: 2000
          });
      }
      return marketFeedRef.current;
  }, [data]);

  const stopMarketFeed = useCallback(() => {
      const feed = marketFeedRef.current;
      if (feed) {
          feed.stop();
      }
      setMarketStatus(prev => ({ ...prev, state: 'STOPPED', message: '行情已停止。' }));
  }, []);

  const startMarketFeed = useCallback(() => {
      if (marketSource !== 'SIMULATED') {
          setMarketStatus({ state: 'STOPPED', source: marketSource, message: '尚未接入真實行情。' });
          return;
      }
      const feed = ensureSimulatedFeed();
      if (feed.isRunning()) {
          setMarketStatus({ state: 'RUNNING', source: 'SIMULATED', message: '模擬行情執行中。' });
          return;
      }
      if (marketUnsubsRef.current.length === 0) {
          marketUnsubsRef.current.push(
              feed.on('candle', (event) => {
                  setData(prev => {
                      const next = [...prev, event.candle];
                      return next.length > 2000 ? next.slice(-2000) : next;
                  });
              })
          );
          marketUnsubsRef.current.push(
              feed.on('status', (event) => setMarketStatus(event.status))
          );
          marketUnsubsRef.current.push(
              feed.on('error', (event) => setMarketStatus({ state: 'STOPPED', source: 'SIMULATED', message: event.error }))
          );
      }
      feed.start();
  }, [ensureSimulatedFeed, marketSource]);

  useEffect(() => {
      if (marketSource === 'SIMULATED') {
          const feed = marketFeedRef.current;
          if (feed && feed.isRunning()) {
              return;
          }
          setMarketStatus({ state: 'IDLE', source: 'SIMULATED', message: '已選擇模擬行情。' });
          if (feed && !feed.isRunning()) {
              feed.updateSeed(data);
          }
          return;
      }
      stopMarketFeed();
      setMarketStatus({ state: 'STOPPED', source: marketSource, message: '尚未接入真實行情。' });
  }, [marketSource, data, stopMarketFeed]);

  useEffect(() => {
      if (!activeStrategy) return;
      if (!activeStrategy.isEnabled) return;
      if (!activeStrategy.code?.trim()) {
          setEvolutionLog(prev => ["?? 策略尚無代碼，無法產生交易標記。", ...prev]);
          return;
      }
      const lastTime = data.length > 0 ? data[data.length - 1].time : '';
      const key = `${activeStrategy.id}-${data.length}-${lastTime}`;
      if (autoBacktestRef.current === key) return;
      if (data.length < 50) {
          setEvolutionLog(prev => ["?? 資料不足，無法產生策略交易標記。", ...prev]);
          return;
      }
      if (!isPythonReady) {
          setEvolutionLog(prev => ["?? Python 引擎尚未就緒，暫停策略回測。", ...prev]);
          return;
      }
        autoBacktestRef.current = key;
        if (isWfoEnabled) {
            backtestSystem.runWalkForward(wfoConfig, optMethod, optTarget);
        } else {
            backtestSystem.runBacktest(autoOptimize, optMethod, optTarget);
        }
  }, [activeStrategy, data, isPythonReady, autoOptimize, optMethod, optTarget, backtestSystem, setEvolutionLog, isWfoEnabled, wfoConfig]);

  useEffect(() => {
    if (!settingsReady) return;
    const timer = window.setInterval(() => {
      handleRefreshTasks();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [settingsReady, handleRefreshTasks]);

  const handleGenerateStrategy = async () => {
    if (!aiPrompt.trim()) return;
    setIsGenerating(true); setEvolutionLog(prev => [`[AI] 請求生成...`, ...prev]);
    
      if (activeStrategyTab === 'Standard') {
        const result = await generateStrategy(aiPrompt, data);
        if (result.name !== "Error") {
          const newStrat: Strategy = buildStrategyBase({
              id: `AI-${Date.now()}`,
              type: 'Standard',
              name: result.name,
              description: result.explanation,
              code: result.code,
              parameters: {},
              isEnabled: false
          });
          setStrategies(prev => {
              const updated = [...prev, newStrat];
              api.saveStrategies(updated); 
              return updated;
          }); 
          setResearchStrategyId(newStrat.id);
          setEvolutionLog(prev => [`[AI] 已生成腳本策略: ${result.name}`, ...prev]);
          openAiLab();
          setShowNewStrategyInput(false);
          setAiPrompt('');
        } else { setEvolutionLog(prev => [`錯誤: ${result.explanation}`, ...prev]); }

    } else {
        // --- RL Generation (Custom Agent) ---
        const result = await generateRLAgent(aiPrompt);
        const newStrat: Strategy = buildStrategyBase({
            id: `RL-AI-${Date.now()}`,
            type: 'RL',
            name: result.name,
            description: result.explanation,
            code: '', // Initially empty, will hold policy after training
            version: 1,
            rlConfig: result.config,
            rlEnvCode: result.envCode // Store custom environment
        });
        setStrategies(prev => {
            const updated = [...prev, newStrat];
            api.saveStrategies(updated);
            return updated;
        });
        setResearchStrategyId(newStrat.id);
        setRlConfig(result.config); // Sync state
        setEvolutionLog(prev => [`[AI] 已生成客製化 DQN 代理人: ${result.name}`, ...prev]);
        openRlTraining();
        setShowNewStrategyInput(false);
        setAiPrompt('');
    }
    setIsGenerating(false);
  };
  
  const handleEvolveStrategy = async () => {
    if (isGenerating) return;
    if (!aiTargetStrategy) return;
    
    // --- RL Evolution (Hyperparameter Tuning) ---
    if (aiTargetStrategy.type === 'RL') {
        if (rlHistory.length === 0) {
            alert("請先訓練 RL 代理人產生歷史數據後再進行進化。");
            return;
        }
        setIsGenerating(true);
        setCurrentAiTask('evolve');
        setEvolutionLog(prev => [`🧬 正在分析 RL 訓練歷史並優化參數...`, ...prev]);
        setAiProgress(50);

        const result = await evolveRLConfig(aiTargetStrategy.rlConfig || rlConfig, rlHistory);
        
        const updated: Strategy = {
            ...aiTargetStrategy,
            rlConfig: result.config,
            description: aiTargetStrategy.description + `\n\n[Auto-Evolve] ${result.reasoning}`,
            version: aiTargetStrategy.version + 0.1
        };

        setStrategies(prev => {
            const newStrategies = prev.map(s => s.id === aiTargetStrategy.id ? updated : s);
            api.saveStrategies(newStrategies);
            return newStrategies;
        });
        setRlConfig(result.config);
        setEvolutionLog(prev => [`✅ RL 參數優化完成: ${result.reasoning}`, ...prev]);
        setAiProgress(100);
        setTimeout(() => { setIsGenerating(false); setCurrentAiTask(null); setAiProgress(0); }, 1000);
        return;
    }

    // --- Standard Strategy Evolution (Existing Logic) ---
    if (data.length < 50) { alert("請先生成足夠的歷史資料"); return; }
    
    setIsGenerating(true); 
    setCurrentAiTask('evolve'); 
    setAiProgress(0);
    
    setEvolutionLog(prev => [`🔍 正在確認當前策略基準績效...`, ...prev]);
    let originalPerformance = aiTargetStrategy.performance;

    try {
        const baselineStats = await researchBacktestSystem.evaluateStrategy(aiTargetStrategy.code, aiTargetStrategy.parameters);
        
        originalPerformance = {
            totalReturn: Number(baselineStats.totalReturn.toFixed(2)),
            netProfit: Number(baselineStats.netProfit.toFixed(0)),
            maxDrawdown: Number(baselineStats.mdd.toFixed(2)),
            winRate: Number(Math.min(1, baselineStats.winRate).toFixed(2)),
            profitFactor: Number(baselineStats.pf.toFixed(2)),
            payoffRatio: 0, 
            totalTrades: baselineStats.totalTrades,
            avgTrade: Number(baselineStats.avgTrade.toFixed(0)),
            sqn: Number(baselineStats.sqn.toFixed(2)),
            totalTax: baselineStats.totalTax,
            totalCommission: baselineStats.totalCommission,
            totalSlippage: baselineStats.totalSlippage
        };

        const updatedBaseline: Strategy = {
            ...aiTargetStrategy,
            performance: originalPerformance
        };
        setStrategies(prev => prev.map(s => s.id === aiTargetStrategy.id ? updatedBaseline : s));
        
        setEvolutionLog(prev => [`📊 基準績效確認: Net Profit $${originalPerformance.netProfit.toLocaleString()}, MDD ${originalPerformance.maxDrawdown}%`, ...prev]);
        setAiProgress(5); 

    } catch (e: any) {
        setEvolutionLog(prev => [`❌ 無法執行基準回測，請檢查 Python 代碼: ${e.message}`, ...prev]);
        setIsGenerating(false);
        setCurrentAiTask(null);
        return;
    }

    const maxRetries = 3;
    let improved = false;

    setEvolutionLog(prev => [`🚀 開始 AI 自動進化 (上限 ${maxRetries} 次嘗試)...`, ...prev]);

    for (let i = 0; i < maxRetries; i++) {
        setEvolutionLog(prev => [`[Attempt ${i+1}/${maxRetries}] 正在請求 AI 改寫策略...`, ...prev]);
        setAiProgress(10 + (i * 20));

        const statsStr = `Return: ${originalPerformance.totalReturn}%, NetProfit: ${originalPerformance.netProfit}, MDD: ${originalPerformance.maxDrawdown}%`;
        const result = await improveStrategy(aiTargetStrategy, statsStr);
        
        if (result.code === aiTargetStrategy.code) {
             setEvolutionLog(prev => [`[Attempt ${i+1}] AI 未能產生不同的代碼。`, ...prev]);
             continue;
        }

        setEvolutionLog(prev => [`[Attempt ${i+1}] 新策略代碼生成。正在進行參數最佳化...`, ...prev]);
        const bestParams = await researchBacktestSystem.handleOptimization('GRID', 'NET_PROFIT', result.code, aiTargetStrategy.parameters);
        const finalParams = bestParams || aiTargetStrategy.parameters;

        try {
            const stats = await researchBacktestSystem.evaluateStrategy(result.code, finalParams);
            
            setEvolutionLog(prev => [`[Attempt ${i+1}] 回測結果: Net Profit $${stats.netProfit.toLocaleString()} (Old: $${originalPerformance.netProfit.toLocaleString()})`, ...prev]);

            if (stats.netProfit > originalPerformance.netProfit) {
                const newVersion = aiTargetStrategy.version + 1;
                const updated: Strategy = {
                    ...aiTargetStrategy,
                    code: result.code,
                    parameters: finalParams,
                    performance: {
                        totalReturn: Number(stats.totalReturn.toFixed(2)),
                        netProfit: Number(stats.netProfit.toFixed(0)),
                        maxDrawdown: Number(stats.mdd.toFixed(2)),
                        winRate: Number(Math.min(1, stats.winRate).toFixed(2)),
                        profitFactor: Number(stats.pf.toFixed(2)),
                        payoffRatio: 0, 
                        totalTrades: stats.totalTrades,
                        avgTrade: Number(stats.avgTrade.toFixed(0)),
                        sqn: Number(stats.sqn.toFixed(2)),
                        totalTax: stats.totalTax,
                        totalCommission: stats.totalCommission,
                    totalSlippage: stats.totalSlippage
                },
                version: newVersion,
                description: aiTargetStrategy.description + `\n\n[v${newVersion} AI-Auto] ${result.improvements}\nImproved Profit: $${stats.netProfit.toLocaleString()}`
                };

                setStrategies(prev => {
                    const newStrategies = prev.map(s => s.id === aiTargetStrategy.id ? updated : s);
                    api.saveStrategies(newStrategies); // Auto save
                    return newStrategies;
                });
                setEvolutionLog(prev => [`✨ 策略進化成功！已更新至 v${newVersion} 並儲存。`, ...prev]);
                improved = true;
                break;
            } else {
                 setEvolutionLog(prev => [`⚠️ 績效未提升，繼續嘗試...`, ...prev]);
            }
        } catch (e: any) {
             setEvolutionLog(prev => [`[Attempt ${i+1}] 回測執行錯誤: ${e.message}`, ...prev]);
        }
    }

    if (!improved) {
        setEvolutionLog(prev => [`❌ 經過 ${maxRetries} 次嘗試，未能產出更好的策略。已退回原版本。`, ...prev]);
    }

    setAiProgress(100);
    setTimeout(() => { setIsGenerating(false); setCurrentAiTask(null); setAiProgress(0); }, 1000);
  };

  const handleModifyStrategy = async () => {
    if (!modificationPrompt.trim()) return;
    if (!aiTargetStrategy?.code) return;
    setIsGenerating(true);
    const result = await refineStrategy(aiTargetStrategy.code, modificationPrompt);
    if (!result.changes.startsWith("修改失敗")) {
        const updated = { ...aiTargetStrategy, code: result.code, version: aiTargetStrategy.version + 1, description: aiTargetStrategy.description + `\n\n[v${aiTargetStrategy.version + 1}] ${result.changes}` };
        setStrategies(prev => {
            const newStrategies = prev.map(s => s.id === aiTargetStrategy.id ? updated : s);
            api.saveStrategies(newStrategies);
            return newStrategies;
        });
    }
    setIsGenerating(false); setModificationPrompt('');
  };

  // -- RL Agent Training Handler --
  const handleStartRLTraining = async () => {
      // Use Target Strategy Config if available, else use Global
      const currentRLConfig = rlTargetStrategy.type === 'RL' && rlTargetStrategy.rlConfig ? rlTargetStrategy.rlConfig : rlConfig;
      // Get Custom Environment Code if available
      const currentEnvCode = rlTargetStrategy.type === 'RL' && rlTargetStrategy.rlEnvCode ? rlTargetStrategy.rlEnvCode : undefined;

      if (data.length < 500) {
          alert("歷史資料不足，請先生成至少 500 根 K 線");
          return;
      }
      setIsRlTraining(true);
      setRlHistory([]);
      setGeneratedRlCode(null);
      setRlProgress(0);
      setEvolutionLog(prev => [`🤖 開始訓練強化學習代理人 (Episodes: ${currentRLConfig.episodes})...`, currentEnvCode ? "📝 使用自定義環境代碼。" : "📝 使用預設環境。", ...prev]);

      try {
          // This call now runs the training loop in the worker and returns the history + code
          // It also streams progress via callback
          const result = await trainRLAgent(data, currentRLConfig, currentEnvCode, (progress, step) => {
              setRlProgress(progress);
              setRlHistory(prev => {
                  // Optimization: only append if not already exists (episode check)
                  if (prev.length > 0 && prev[prev.length-1].episode === step.episode) return prev;
                  return [...prev, step];
              });
          });
          
          setRlHistory(result.history); // Ensure final consistency
          setGeneratedRlCode(result.generatedCode);
          
          // Update the target RL strategy with the generated code
          if (rlTargetStrategy.type === 'RL') {
              const updated = { ...rlTargetStrategy, code: result.generatedCode };
              setStrategies(prev => {
                  const newStrategies = prev.map(s => s.id === rlTargetStrategy.id ? updated : s);
                  api.saveStrategies(newStrategies);
                  return newStrategies;
              });
              setEvolutionLog(prev => [`💾 訓練完成！代碼已儲存至 "${rlTargetStrategy.name}"`, ...prev]);
          }

          setRlProgress(100);
          setEvolutionLog(prev => [`✅ RL 訓練結束。`, ...prev]);
      } catch (e: any) {
          setEvolutionLog(prev => [`❌ RL 訓練失敗: ${e.message}`, ...prev]);
      } finally {
          setIsRlTraining(false);
      }
  };

  const handleExportRLAgent = () => {
      if (!generatedRlCode) return;
      
      // If we are already in an RL strategy, just ensure code is saved (already done in train step)
      // If we are in standard mode training a one-off, create new strategy
      if (rlTargetStrategy.type === 'RL') {
           setEvolutionLog(prev => [`ℹ️ 當前已是 RL 策略模式，代碼已自動更新。`, ...prev]);
           setActiveMode(AppMode.BACKTEST);
           return;
      }

      const newStrat: Strategy = buildStrategyBase({ 
          id: `RL-${Date.now()}`, 
          type: 'RL', // Set type to RL Agent
          name: 'DQN Agent (Exported)', 
          description: `基於 Deep Q-Network 訓練的代理人。\nEpisodes: ${rlConfig.episodes}\nGamma: ${rlConfig.discountFactor}\nLayer: ${rlConfig.hiddenLayerSize}`, 
          code: generatedRlCode, 
          version: 1,
          rlConfig: rlConfig
      });
      setStrategies(prev => {
          const updated = [...prev, newStrat];
          api.saveStrategies(updated);
          return updated;
      });
      setResearchStrategyId(newStrat.id);
      setActiveMode(AppMode.BACKTEST);
      setEvolutionLog(prev => [`💾 DQN 策略已儲存並切換至回測模式。`, ...prev]);
  };
  
  // Handle local parameter changes for RL config update
  const handleRLConfigUpdate = (newConfig: RLConfig) => {
      setRlConfig(newConfig);
      if (rlTargetStrategy.type === 'RL') {
          setStrategies(prev => prev.map(s => s.id === rlTargetStrategy.id ? {...s, rlConfig: newConfig} : s));
      }
  };

  const displayedTrades = backtestTrades;
  const recentTrades = useMemo(() => {
    const combined = [...executionTrades, ...backtestTrades];
    return combined.sort((a, b) => b.time.localeCompare(a.time)).slice(0, 200);
  }, [executionTrades, backtestTrades]);

  useEffect(() => {
    if (activeMode === AppMode.DOCS) return;
    setLastNonDocsMode(activeMode);
  }, [activeMode]);

  // -- Layout Engine --
  const [maximizedWidget, setMaximizedWidget] = useState<WidgetId | null>(null);
  const layoutContainerRef = useRef<HTMLDivElement | null>(null);
  
  // Refined Default Layouts based on User Export
  const [layouts, setLayouts] = useState<LayoutsConfig>(DEFAULT_LAYOUTS);
  
  const [widgetSizes, setWidgetSizes] = useState<WidgetSizesConfig>(DEFAULT_WIDGET_SIZES);
  const [widgetLayout, setWidgetLayout] = useState<WidgetLayoutsConfig>(DEFAULT_WIDGET_LAYOUTS);
  const [widgetMinimized, setWidgetMinimized] = useState<WidgetMinimizedConfig>(DEFAULT_WIDGET_MINIMIZED);
  const [widgetOrder, setWidgetOrder] = useState<Record<AppMode, WidgetId[]>>(buildDefaultOrder(DEFAULT_LAYOUTS));

  const bringWidgetToFront = useCallback((id: WidgetId, mode: AppMode) => {
    setWidgetOrder(prev => {
      const current = prev[mode] || [];
      if (current[current.length - 1] === id) return prev;
      const next = [...current.filter((wid) => wid !== id), id];
      return { ...prev, [mode]: next };
    });
  }, []);

  const ensureOrderForMode = useCallback((mode: AppMode, ids: WidgetId[]) => {
    setWidgetOrder(prev => {
      const current = prev[mode] || [];
      let next = current.filter((id) => ids.includes(id));
      ids.forEach((id) => {
        if (!next.includes(id)) next.push(id);
      });
      if (next.length === current.length && next.every((id, idx) => id === current[idx])) {
        return prev;
      }
      return { ...prev, [mode]: next };
    });
  }, []);

  useEffect(() => {
    (Object.values(AppMode) as AppMode[]).forEach((mode) => {
      const ids = layouts[mode] || DEFAULT_LAYOUTS[mode] || [];
      ensureOrderForMode(mode, ids);
    });
  }, [layouts, ensureOrderForMode]);

  const openWidgetsInMode = useCallback((mode: AppMode, ids: WidgetId[]) => {
      if (ids.length === 0) return;
      setLayouts(prev => {
          const current = prev[mode] || DEFAULT_LAYOUTS[mode] || [];
          let next = current;
          ids.forEach((id) => {
              if (!next.includes(id)) {
                  next = [...next, id];
              }
          });
          if (next === current) return prev;
          return { ...prev, [mode]: next };
      });
      setWidgetLayout(prev => {
          const modeLayout = { ...(prev[mode] || {}) };
          const existingIds = layouts[mode] || DEFAULT_LAYOUTS[mode] || [];
          let maxBottom = 0;
          existingIds.forEach((id) => {
              const item = modeLayout[id] || prev[mode]?.[id] || DEFAULT_WIDGET_LAYOUTS[mode]?.[id];
              if (!item) return;
              maxBottom = Math.max(maxBottom, item.y + item.heightPx);
          });
          ids.forEach((id) => {
              if (modeLayout[id]) return;
              const fallback = DEFAULT_WIDGET_LAYOUTS[mode]?.[id]
                  || DEFAULT_WIDGET_LAYOUTS[AppMode.AI_LAB]?.[id]
                  || DEFAULT_WIDGET_LAYOUTS[AppMode.BACKTEST]?.[id]
                  || BASE_WIDGET_LAYOUTS[mode]?.[id]
                  || BASE_WIDGET_LAYOUTS[AppMode.RL_AGENT]?.[id]
                  || BASE_WIDGET_LAYOUTS[AppMode.AI_LAB]?.[id]
                  || BASE_WIDGET_LAYOUTS[AppMode.BACKTEST]?.[id];
              if (!fallback) return;
              const y = maxBottom > 0 ? maxBottom + 16 : fallback.y;
              modeLayout[id] = { ...fallback, y };
              maxBottom = Math.max(maxBottom, y + fallback.heightPx);
          });
          return { ...prev, [mode]: modeLayout };
      });
      setWidgetMinimized(prev => {
          const modeMap = { ...(prev[mode] || {}) };
          ids.forEach((id) => {
              modeMap[id] = false;
          });
          return { ...prev, [mode]: modeMap };
      });
      setWidgetOrder(prev => {
          const current = prev[mode] || [];
          let next = current.filter((id) => !ids.includes(id));
          next = [...next, ...ids];
          return { ...prev, [mode]: next };
      });
  }, [layouts]);

  const openRlTraining = useCallback(() => {
      const mode = AppMode.RL_AGENT;
      setActiveMode(mode);
      openWidgetsInMode(mode, ['rlTraining']);
  }, [openWidgetsInMode]);

  const openAiLab = useCallback(() => {
      const targetMode = activeMode === AppMode.DOCS ? lastNonDocsMode : activeMode;
      const mode = targetMode || AppMode.BACKTEST;
      openWidgetsInMode(mode, ['aiControls', 'codeEditor', 'systemLog']);
  }, [activeMode, lastNonDocsMode, openWidgetsInMode]);

  const openCodeEditorFromLab = useCallback(() => {
      const targetMode = activeMode === AppMode.DOCS ? lastNonDocsMode : activeMode;
      const mode = targetMode || AppMode.BACKTEST;
      setActiveMode(mode);
      openWidgetsInMode(mode, ['codeEditor']);
  }, [activeMode, lastNonDocsMode, openWidgetsInMode]);

  const openAiEvolutionFromLab = useCallback(() => {
      const targetMode = activeMode === AppMode.DOCS ? lastNonDocsMode : activeMode;
      const mode = targetMode || AppMode.BACKTEST;
      setActiveMode(mode);
      openWidgetsInMode(mode, ['aiControls', 'codeEditor', 'systemLog']);
  }, [activeMode, lastNonDocsMode, openWidgetsInMode]);

  const openRlTrainingFromLab = useCallback(() => {
      const targetMode = activeMode === AppMode.DOCS ? lastNonDocsMode : activeMode;
      const mode = targetMode || AppMode.BACKTEST;
      setActiveMode(mode);
      openWidgetsInMode(mode, ['rlTraining']);
  }, [activeMode, lastNonDocsMode, openWidgetsInMode]);
  const [dockCollapsed, setDockCollapsed] = useState(true);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const dockStartRef = useRef<HTMLButtonElement | null>(null);
  const headerRef = useRef<HTMLDivElement | null>(null);
  const [dockPosition, setDockPosition] = useState({ x: 8, y: 8 });
  const [dockSafePaddingLeft, setDockSafePaddingLeft] = useState(0);
  const [dockHeaderOffset, setDockHeaderOffset] = useState(0);
  const [dockDragState, setDockDragState] = useState<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const getHeaderHeight = () => headerRef.current?.offsetHeight || 64;
  const getDockStartWidth = () => dockStartRef.current?.offsetWidth || 72;

  const widgetMeta = useMemo<Record<WidgetId, { title: string; icon: React.ComponentType<any> }>>(() => ({
    marketChart: { title: '行情', icon: Activity },
    orderFlow: { title: 'OrderFlow', icon: Layers },
    strategyManager: { title: '策略', icon: Cpu },
    backtestLab: { title: '回測實驗室', icon: FlaskConical },
    manualTrade: { title: '手動', icon: MousePointer2 },
    recentTrades: { title: '交易明細', icon: List },
    taskMonitor: { title: '任務', icon: Cloud },
    systemLog: { title: '日誌', icon: Terminal },
    backtestControls: { title: '資料', icon: Database },
    perfStats: { title: '績效', icon: BarChart2 },
    backtestRuns: { title: '摘要', icon: History },
    configEditor: { title: '設定', icon: Settings },
    equityCurve: { title: '權益', icon: TrendingUp },
    codeEditor: { title: '程式碼', icon: Code },
    aiControls: { title: 'AI', icon: Zap },
    rlTraining: { title: 'DQN', icon: BrainCircuit }
  }), [activeMode]);

  const dockWidgetIds = useMemo(() => {
    const ids = new Set<WidgetId>();
    const hiddenInDock = new Set<WidgetId>(['aiControls', 'codeEditor', 'rlTraining']);
    ([AppMode.BACKTEST, AppMode.RL_AGENT, AppMode.AI_LAB] as AppMode[]).forEach((mode) => {
      (layouts[mode] || DEFAULT_LAYOUTS[mode] || []).forEach((id) => {
        if (hiddenInDock.has(id)) return;
        ids.add(id);
      });
    });
    return Array.from(ids);
  }, [layouts]);


  const widgetModeMap = useMemo<Record<WidgetId, AppMode>>(() => {
    const map: Partial<Record<WidgetId, AppMode>> = {};
    ([AppMode.BACKTEST, AppMode.RL_AGENT, AppMode.AI_LAB] as AppMode[]).forEach((mode) => {
      (layouts[mode] || DEFAULT_LAYOUTS[mode] || []).forEach((id) => {
        if (!map[id]) map[id] = mode;
      });
    });
    return map as Record<WidgetId, AppMode>;
  }, [layouts]);

  useEffect(() => {
    const dockWidth = dockRef.current?.offsetWidth || getDockStartWidth();
    const x = Math.max(8, Math.min(window.innerWidth - dockWidth - 8, 8));
    setDockPosition({ x, y: 8 });
  }, []);

  const clampDockPosition = useCallback((_x: number, _y: number) => {
    const dockWidth = dockRef.current?.offsetWidth || getDockStartWidth();
    const maxX = Math.max(8, window.innerWidth - dockWidth - 8);
    return {
      x: Math.max(8, Math.min(8, maxX)),
      y: 8
    };
  }, []);

  const handleDockDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDockDragState({
      startX: e.clientX,
      startY: e.clientY,
      originX: dockPosition.x,
      originY: dockPosition.y
    });
  };

  useEffect(() => {
    if (!dockDragState) return;
    const handleMove = (event: MouseEvent) => {
      const deltaX = event.clientX - dockDragState.startX;
      const deltaY = event.clientY - dockDragState.startY;
      const next = clampDockPosition(dockDragState.originX + deltaX, dockDragState.originY + deltaY);
      setDockPosition(next);
    };
    const handleUp = () => setDockDragState(null);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [dockDragState, clampDockPosition]);

  useEffect(() => {
    const handleResize = () => {
      setDockPosition((prev) => clampDockPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampDockPosition]);

  useEffect(() => {
    const handleOutsideDockClick = (event: PointerEvent) => {
      if (dockCollapsed) return;
      const target = event.target as Node | null;
      if (!target) return;
      if (dockRef.current && dockRef.current.contains(target)) return;
      setDockCollapsed(true);
    };
    window.addEventListener('pointerdown', handleOutsideDockClick, true);
    return () => window.removeEventListener('pointerdown', handleOutsideDockClick, true);
  }, [dockCollapsed]);

  useEffect(() => {
    setDockSafePaddingLeft(0);
    setDockHeaderOffset(getDockStartWidth() + 12);
  }, [dockCollapsed, dockPosition]);

  const applyBestWidgetSize = useCallback((mode: AppMode, id: WidgetId) => {
    const best = DEFAULT_WIDGET_LAYOUTS[mode]?.[id];
    const base = best || DEFAULT_WIDGET_LAYOUTS[AppMode.BACKTEST]?.[id];
    if (!base) return;
    setWidgetLayout(prev => {
      const modeLayout = { ...(prev[mode] || {}) };
      const current = modeLayout[id];
      const container = layoutContainerRef.current;
      const maxX = container ? Math.max(0, container.clientWidth - base.widthPx) : 0;
      const x = Math.min(16, maxX);
      const y = 16;
      if (current) {
        modeLayout[id] = { ...current, x, y, widthPx: base.widthPx, heightPx: base.heightPx };
      } else {
        modeLayout[id] = { ...base, x, y };
      }
      return { ...prev, [mode]: modeLayout };
    });
  }, []);

  const minimizeAllWidgets = useCallback(() => {
    const mode = activeMode;
    const ids = layouts[mode] || DEFAULT_LAYOUTS[mode] || [];
    if (ids.length === 0) return;
    setWidgetMinimized(prev => {
      const modeMap = { ...(prev[mode] || {}) };
      ids.forEach((id) => {
        modeMap[id] = true;
      });
      return { ...prev, [mode]: modeMap };
    });
    setMaximizedWidget(null);
  }, [activeMode, layouts]);


  const clampLayoutToViewport = useCallback((mode: AppMode) => {
    const container = layoutContainerRef.current;
    if (!container) return;
    const maxWidth = Math.max(0, container.clientWidth);
    if (maxWidth === 0) return;
    const ids = layouts[mode] || DEFAULT_LAYOUTS[mode] || [];
    setWidgetLayout(prev => {
      const modeLayout = { ...(prev[mode] || {}) };
      let changed = false;
      ids.forEach((id) => {
        const item = modeLayout[id] || DEFAULT_WIDGET_LAYOUTS[mode]?.[id];
        if (!item) return;
        const minimized = widgetMinimized[mode]?.[id] ?? true;
        if (minimized) return;
        const minWidth = Math.min(260, maxWidth);
        const width = Math.max(minWidth, Math.min(item.widthPx, maxWidth));
        const maxX = Math.max(0, maxWidth - width);
        const x = Math.min(Math.max(0, item.x), maxX);
        if (width !== item.widthPx || x !== item.x) {
          modeLayout[id] = { ...item, widthPx: width, x };
          changed = true;
        }
      });
      if (!changed) return prev;
      return { ...prev, [mode]: modeLayout };
    });
  }, [layouts, widgetMinimized]);

  const cascadeWindows = useCallback(() => {
    const mode = activeMode;
    const ids = layouts[mode] || DEFAULT_LAYOUTS[mode] || [];
    if (ids.length === 0) return;
    const startX = 16;
    const startY = 16;
    const step = 28;
    setWidgetLayout(prev => {
      const modeLayout = { ...(prev[mode] || {}) };
      let index = 0;
      ids.forEach((id) => {
        const base = modeLayout[id]
          || DEFAULT_WIDGET_LAYOUTS[mode]?.[id]
          || DEFAULT_WIDGET_LAYOUTS[AppMode.BACKTEST]?.[id];
        if (!base) return;
        modeLayout[id] = {
          ...base,
          x: startX + index * step,
          y: startY + index * step
        };
        index += 1;
      });
      return { ...prev, [mode]: modeLayout };
    });
    setWidgetMinimized(prev => {
      const modeMap = { ...(prev[mode] || {}) };
      ids.forEach((id) => {
        modeMap[id] = false;
      });
      return { ...prev, [mode]: modeMap };
    });
    setMaximizedWidget(null);
    clampLayoutToViewport(mode);
  }, [activeMode, layouts, clampLayoutToViewport]);

  const toggleWidgetMinimized = useCallback((id: WidgetId, modeOverride?: AppMode) => {
    let shouldExpand = false;
    let nextIsMinimized = false;
    const targetMode = modeOverride || activeMode;
    setWidgetMinimized(prev => {
      const modeMap = { ...(prev[targetMode] || {}) };
      const current = modeMap[id] ?? true;
      const next = !current;
      modeMap[id] = next;
      shouldExpand = current && !next;
      nextIsMinimized = next;
      return { ...prev, [targetMode]: modeMap };
    });
    if (nextIsMinimized && maximizedWidget === id && targetMode === activeMode) {
      setMaximizedWidget(null);
    }
    if (shouldExpand) {
      setWidgetOrder(prev => {
        const current = prev[targetMode] || [];
        const next = [...current.filter((wid) => wid !== id), id];
        return { ...prev, [targetMode]: next };
      });
    }
  }, [activeMode, maximizedWidget]);

  const layoutHeight = useMemo(() => {
    const modeLayout = widgetLayout[activeMode] || {};
    const ids = layouts[activeMode] || DEFAULT_LAYOUTS[activeMode] || [];
    let maxBottom = 0;
    ids.forEach((id) => {
      const item = modeLayout[id] || DEFAULT_WIDGET_LAYOUTS[activeMode]?.[id];
      if (!item) return;
      const minimized = widgetMinimized[activeMode]?.[id] ?? true;
      if (minimized) return;
      maxBottom = Math.max(maxBottom, item.y + item.heightPx);
    });
    return Math.max(800, maxBottom + 40);
  }, [activeMode, layouts, widgetLayout, widgetMinimized]);

  useEffect(() => {
    clampLayoutToViewport(activeMode);
  }, [activeMode, clampLayoutToViewport, widgetMinimized]);

  useEffect(() => {
    const handleResize = () => clampLayoutToViewport(activeMode);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeMode, clampLayoutToViewport]);

  useEffect(() => {
    if (!settingsReady) return;
    if (settingsSaveTimer.current !== null) {
      window.clearTimeout(settingsSaveTimer.current);
    }
    settingsSaveTimer.current = window.setTimeout(() => {
      const nextSettings: SystemSettings = {
          costConfig,
          wfoConfig,
          isWfoEnabled,
          optMethod,
          optTarget,
          autoOptimize,
          marketScope,
          layouts,
          widgetSizes,
          widgetLayout,
          widgetMinimized
      };
      api.saveSettings(nextSettings);
    }, 400);
    return () => {
      if (settingsSaveTimer.current !== null) {
        window.clearTimeout(settingsSaveTimer.current);
      }
    };
  }, [settingsReady, costConfig, wfoConfig, isWfoEnabled, optMethod, optTarget, autoOptimize, marketScope, layouts, widgetSizes, widgetLayout, widgetMinimized]);

  const [movingState, setMovingState] = useState<{
    id: WidgetId;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const handleMoveStart = useCallback((e: React.MouseEvent, id: WidgetId) => {
    if (maximizedWidget) return;
    const layout = widgetLayout[activeMode]?.[id]
      || DEFAULT_WIDGET_LAYOUTS[activeMode]?.[id]
      || BASE_WIDGET_LAYOUTS[activeMode]?.[id]
      || BASE_WIDGET_LAYOUTS[AppMode.RL_AGENT]?.[id]
      || BASE_WIDGET_LAYOUTS[AppMode.AI_LAB]?.[id]
      || BASE_WIDGET_LAYOUTS[AppMode.BACKTEST]?.[id];
    if (!layout) return;
    if (!widgetLayout[activeMode]?.[id]) {
      setWidgetLayout(prev => ({
        ...prev,
        [activeMode]: { ...(prev[activeMode] || {}), [id]: { ...layout } }
      }));
    }
    e.preventDefault();
    e.stopPropagation();
    setMovingState({
      id,
      startX: e.clientX,
      startY: e.clientY,
      originX: layout.x,
      originY: layout.y
    });
  }, [activeMode, maximizedWidget, widgetLayout]);

  // -- Resize Logic --
  const [resizingState, setResizingState] = useState<{
    id: WidgetId;
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  const handleResizeStart = useCallback((e: React.MouseEvent, id: WidgetId) => {
    if (widgetMinimized[activeMode]?.[id] ?? true) return;
    e.preventDefault();
    e.stopPropagation();
    const layout = widgetLayout[activeMode]?.[id]
      || DEFAULT_WIDGET_LAYOUTS[activeMode]?.[id]
      || BASE_WIDGET_LAYOUTS[activeMode]?.[id]
      || BASE_WIDGET_LAYOUTS[AppMode.RL_AGENT]?.[id]
      || BASE_WIDGET_LAYOUTS[AppMode.AI_LAB]?.[id]
      || BASE_WIDGET_LAYOUTS[AppMode.BACKTEST]?.[id];
    if (!layout) return;
    if (!widgetLayout[activeMode]?.[id]) {
      setWidgetLayout(prev => ({
        ...prev,
        [activeMode]: { ...(prev[activeMode] || {}), [id]: { ...layout } }
      }));
    }
    setResizingState({
      id,
      startX: e.clientX,
      startY: e.clientY,
      startWidth: layout.widthPx,
      startHeight: layout.heightPx
    });
  }, [activeMode, widgetLayout, widgetMinimized]);

  useEffect(() => {
    if (!movingState) return;

    const handleMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - movingState.startX;
        const deltaY = e.clientY - movingState.startY;
        setWidgetLayout(prev => {
            const modeLayout = { ...(prev[activeMode] || {}) };
            const current = modeLayout[movingState.id];
            if (!current) return prev;
            const container = layoutContainerRef.current;
            const maxX = container ? Math.max(0, container.clientWidth - current.widthPx) : Infinity;
            const nextX = Math.max(0, Math.min(movingState.originX + deltaX, maxX));
            const nextY = Math.max(0, movingState.originY + deltaY);
            modeLayout[movingState.id] = { ...current, x: nextX, y: nextY };
            return { ...prev, [activeMode]: modeLayout };
        });
    };

    const handleMouseUp = () => {
      setMovingState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [movingState, activeMode]);

  useEffect(() => {
    if (!resizingState) return;

    const handleMouseMove = (e: MouseEvent) => {
        const deltaX = e.clientX - resizingState.startX;
        const deltaY = e.clientY - resizingState.startY;
        const container = layoutContainerRef.current;
        const current = widgetLayout[activeMode]?.[resizingState.id];
        const maxWidth = container ? Math.max(260, container.clientWidth - (current?.x || 0)) : Infinity;
        const newWidth = Math.max(260, Math.min(maxWidth, resizingState.startWidth + deltaX));
        const newHeight = Math.max(180, resizingState.startHeight + deltaY);
        setWidgetLayout(prev => {
            const modeLayout = { ...(prev[activeMode] || {}) };
            const item = modeLayout[resizingState.id];
            if (!item) return prev;
            modeLayout[resizingState.id] = { ...item, widthPx: newWidth, heightPx: newHeight };
            return { ...prev, [activeMode]: modeLayout };
        });
    };

    const handleMouseUp = () => {
      setResizingState(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingState, activeMode, widgetLayout]);

  // -- Widget Render Logic --
  const renderWidget = (id: WidgetId, zIndex: number) => {
      const isMinimized = widgetMinimized[activeMode]?.[id] ?? true;
      const common = { 
          id,
          isMaximized: maximizedWidget === id,
          isMinimized,
          config: widgetSizes[id],
          layout: widgetLayout[activeMode]?.[id]
            || DEFAULT_WIDGET_LAYOUTS[activeMode]?.[id]
            || BASE_WIDGET_LAYOUTS[activeMode]?.[id]
            || BASE_WIDGET_LAYOUTS[AppMode.RL_AGENT]?.[id]
            || BASE_WIDGET_LAYOUTS[AppMode.AI_LAB]?.[id]
            || BASE_WIDGET_LAYOUTS[AppMode.BACKTEST]?.[id],
          zIndex,
          setMaximizedWidget,
          onResizeStart: handleResizeStart,
          onMoveStart: handleMoveStart,
          onToggleMinimize: () => toggleWidgetMinimized(id, activeMode),
          onActivate: () => bringWidgetToFront(id, activeMode)
      };

      const frameProps = {
          ...common,
          onMaximize: () => setMaximizedWidget(id),
          onMinimize: () => setMaximizedWidget(null)
      };

      if (isMinimized && maximizedWidget !== id) {
        return null;
      }
      
      switch(id) {
          case 'marketChart': return <WidgetFrame {...frameProps} title={`行情 · ${activeStrategy?.name || '未選擇策略'}${backtestSystem.isBacktesting || backtestSystem.isOptimizing ? '（回測中）' : ''}`} icon={Activity}><div className="p-1 h-full"><MarketChart data={data} trades={displayedTrades} height="100%" loadDays={loadDays} onLoadDaysChange={handleUpdateLoadDays} onReload={handleReloadMarketData} /></div></WidgetFrame>;
          case 'orderFlow': return <OrderFlowWidget {...common} data={data} />;
          case 'manualTrade': return <ManualTradeWidget {...common} currentPosition={currentPosition} simState={simState} data={data} manualOrderSize={manualOrderSize} setManualOrderSize={setManualOrderSize} handleManualTrade={handleManualTrade} />;
          case 'recentTrades': return <RecentTradesWidget {...common} trades={recentTrades} activeMode={activeMode} />;
          case 'strategyManager': return (
            <StrategyManagerWidget
              {...common}
              strategies={strategies}
              activeStrategy={activeStrategy}
              activeStrategyId={activeStrategyId}
              setActiveStrategyId={setActiveStrategyId}
              activeTab={activeStrategyTab}
              setActiveTab={setActiveStrategyTab}
              activeMode={activeMode}
              setActiveMode={setActiveMode}
              showNewStrategyInput={showNewStrategyInput}
              setShowNewStrategyInput={setShowNewStrategyInput}
              aiPrompt={aiPrompt}
              setAiPrompt={setAiPrompt}
              handleGenerateStrategy={handleGenerateStrategy}
              isGenerating={isGenerating}
              setStrategies={setStrategies}
              setEvolutionLog={setEvolutionLog}
              showOptSettings={showOptSettings}
              setShowOptSettings={setShowOptSettings}
              optMethod={optMethod}
              setOptMethod={setOptMethod}
              optTarget={optTarget}
              setOptTarget={setOptTarget}
              handleOptimization={backtestSystem.handleOptimization}
              aiProgress={aiProgress}
              currentAiTask={currentAiTask}
              handleSaveStrategies={handleSaveStrategies}
              handleSeedStrategies={handleSeedStrategies}
              handleImportStrategies={() => {}}
              handleExportStrategies={() => {}}
              onToggleStrategy={handleToggleStrategy}
              onOpenRlTraining={openRlTraining}
              onOpenBacktestRuns={handleOpenBacktestRuns}
              marketScope={marketScope}
              costConfig={costConfig}
              setCostConfig={setCostConfig}
              wfoConfig={wfoConfig}
              setWfoConfig={setWfoConfig}
              isWfoEnabled={isWfoEnabled}
              setIsWfoEnabled={setIsWfoEnabled}
              intradayMode={intradayMode}
              setIntradayMode={handleUpdateIntradayMode}
              intradayForceCloseTime={intradayForceCloseTime}
              setIntradayForceCloseTime={handleUpdateIntradayForceCloseTime}
            />
          );
          case 'backtestLab': return (
            <BacktestLabWidget
              {...common}
              strategies={strategies}
              setStrategies={setStrategies}
              selectedStrategyId={researchStrategyId}
              setSelectedStrategyId={setResearchStrategyId}
              activeTab={activeStrategyTab}
              setActiveTab={setActiveStrategyTab}
              showNewStrategyInput={showNewStrategyInput}
              setShowNewStrategyInput={setShowNewStrategyInput}
              aiPrompt={aiPrompt}
              setAiPrompt={setAiPrompt}
              modificationPrompt={modificationPrompt}
              setModificationPrompt={setModificationPrompt}
              handleGenerateStrategy={handleGenerateStrategy}
              handleModifyStrategy={handleModifyStrategy}
              isGenerating={isGenerating}
              templates={strategyTemplates}
              onAddManualStrategy={handleAddManualStrategy}
              performance={researchPerformance}
              trades={researchTrades}
              equityCurve={researchEquityCurve}
              onOpenBacktestRuns={handleOpenBacktestRuns}
              backtestStartDate={backtestStartDate}
              setBacktestStartDate={setBacktestStartDate}
              backtestEndDate={backtestEndDate}
              setBacktestEndDate={setBacktestEndDate}
              intradayEnabled={researchIntradayEnabled}
              setIntradayEnabled={setResearchIntradayEnabled}
              intradayMode={intradayMode}
              setIntradayMode={handleUpdateIntradayMode}
              intradayForceCloseTime={intradayForceCloseTime}
              setIntradayForceCloseTime={handleUpdateIntradayForceCloseTime}
              costConfig={costConfig}
              setCostConfig={setCostConfig}
              wfoConfig={wfoConfig}
              setWfoConfig={setWfoConfig}
              isWfoEnabled={isWfoEnabled}
              setIsWfoEnabled={setIsWfoEnabled}
              autoOptimize={autoOptimize}
              setAutoOptimize={setAutoOptimize}
              optMethod={optMethod}
              setOptMethod={setOptMethod}
              optTarget={optTarget}
              setOptTarget={setOptTarget}
              runBacktest={(strategyOverride) => researchBacktestSystem.runBacktest(autoOptimize, optMethod, optTarget, strategyOverride || researchStrategy)}
              cancelBacktest={researchBacktestSystem.cancelBacktest}
              runWfo={(strategyOverride) => researchBacktestSystem.runWalkForward(wfoConfig, optMethod, optTarget, strategyOverride || researchStrategy)}
              isBacktesting={researchBacktestSystem.isBacktesting}
              isOptimizing={researchBacktestSystem.isOptimizing}
              pendingOptimizationUpdate={researchBacktestSystem.pendingOptimizationUpdate}
              onApplyOptimizedParams={researchBacktestSystem.applyOptimizedParams}
              onRejectOptimizedParams={researchBacktestSystem.dismissOptimizedParams}
              backtestProgress={researchBacktestSystem.backtestProgress}
              optimizeProgress={researchBacktestSystem.optimizeProgress}
              isGeneratingData={isGeneratingData}
              onOpenRlTraining={openRlTrainingFromLab}
              onOpenCodeEditor={openCodeEditorFromLab}
            />
          );
          case 'backtestControls': return (
            <DataManagementWidget
              {...common}
              startDate={startDate}
              setStartDate={setStartDate}
              endDate={endDate}
              setEndDate={setEndDate}
              marketScope={marketScope}
              setMarketScope={setMarketScope}
              applyMarketScope={handleApplyMarketScope}
              resetMarketScope={handleResetMarketScope}
              handleGenerateHistory={handleGenerateHistory}
              isGeneratingData={isGeneratingData}
              handleClearDB={handleClearDB}
              handleImportDB={() => {}}
              handleExportDB={() => {}}
            />
          );
          case 'backtestRuns': return <BacktestRunsWidget {...common} runs={backtestRuns} onRefresh={handleRefreshBacktests} onClear={handleClearBacktests} />;
          case 'configEditor': return <ConfigEditorWidget {...common} configText={configText} onChange={setConfigText} onReload={handleReloadConfig} onSave={handleSaveConfig} status={configStatus} />;
          case 'taskMonitor': return <TaskMonitorWidget {...common} tasks={tasks} onRefresh={handleRefreshTasks} />;
          case 'perfStats': return <PerfStatsWidget {...common} activeStrategy={activeStrategy} />;
          case 'equityCurve': return <WidgetFrame {...frameProps} title="權益曲線" icon={TrendingUp}><div className="p-2 h-full"><EquityChart data={equityCurve} height={200}/></div></WidgetFrame>;
          case 'codeEditor': return (
            <WidgetFrame {...frameProps} title={`程式碼 · ${editorStrategy?.name || '未選擇策略'}`} icon={Code}>
              <div className="bg-[#0d1117] p-3 h-full flex flex-col gap-2">
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>直接編輯策略程式碼，會自動保存。</span>
                  <div className="flex items-center gap-2">
                    <span>
                      {codeSaveStatus === 'saving' ? '保存中...' : codeSaveStatus === 'saved' ? '已保存' : codeSaveStatus === 'dirty' ? '未保存' : ' '}
                    </span>
                    <button
                      onClick={handleManualSaveCode}
                      className="px-2 py-0.5 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                    >
                      手動保存
                    </button>
                  </div>
                </div>
                <div className="relative flex-1 border border-slate-800 rounded bg-[#0b1220]">
                  <pre
                    ref={codePreviewRef}
                    className="absolute inset-0 overflow-auto text-[11px] text-slate-200 font-mono whitespace-pre-wrap p-2 pointer-events-none"
                    dangerouslySetInnerHTML={{ __html: highlightPython(codeDraft) + '\n' }}
                  />
                  <textarea
                    ref={codeEditorRef}
                    value={codeDraft}
                    onChange={(e) => handleUpdateActiveCode(e.target.value)}
                    onScroll={(e) => {
                      if (codePreviewRef.current) {
                        codePreviewRef.current.scrollTop = (e.target as HTMLTextAreaElement).scrollTop;
                        codePreviewRef.current.scrollLeft = (e.target as HTMLTextAreaElement).scrollLeft;
                      }
                    }}
                    className="relative z-10 w-full h-full bg-transparent text-xs font-mono whitespace-pre-wrap outline-none p-2 text-transparent caret-slate-200"
                    spellCheck={false}
                  />
                </div>
              </div>
            </WidgetFrame>
          );
          case 'aiControls': return <WidgetFrame {...frameProps} title="AI 指令" icon={Zap}>
            <div className="p-4 bg-slate-950 border-t border-slate-800">
                <div className="flex gap-2 mb-2">
                    <input className="flex-1 bg-slate-900 border border-slate-700 rounded p-2 text-xs text-slate-200" value={modificationPrompt} onChange={e=>setModificationPrompt(e.target.value)} placeholder="輸入指令修改..." />
                    <button onClick={handleModifyStrategy} disabled={isGenerating} className="bg-indigo-600 text-white px-3 py-2 rounded text-xs"><Edit3 size={14}/></button>
                </div>
                <button onClick={handleEvolveStrategy} disabled={isGenerating} className="w-full py-2 bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 rounded text-xs flex justify-center items-center relative overflow-hidden">
                    {isGenerating && currentAiTask === 'evolve' && (
                        <div className="absolute left-0 top-0 bottom-0 bg-emerald-600/20 transition-all duration-300 ease-out" style={{ width: `${aiProgress}%` }}></div>
                    )}
                    <div className="z-10 flex items-center">
                        {isGenerating && currentAiTask === 'evolve' ? <Loader2 size={14} className="mr-2 animate-spin"/> : <FlaskConical size={14} className="mr-2"/>} 
                        {isGenerating && currentAiTask === 'evolve' ? `AI 進化中 (${Math.round(aiProgress)}%)...` : 'AI 自動進化 (Auto-Retry)'}
                    </div>
                </button>
            </div>
            </WidgetFrame>;
          case 'systemLog': return <WidgetFrame {...frameProps} title="日誌" icon={Terminal}><div className="flex-1 p-3 overflow-y-auto font-mono text-xs space-y-1 h-full bg-black/20">{evolutionLog.map((l,i)=><div key={i} className="text-emerald-500/80 border-l-2 border-slate-800 pl-2">{l}</div>)}</div></WidgetFrame>;
          case 'rlTraining': return <RLTrainingWidget {...common} rlConfig={rlConfig} setConfig={handleRLConfigUpdate} history={rlHistory} isTraining={isRlTraining} onStartTraining={handleStartRLTraining} onExportAgent={handleExportRLAgent} hasTrainedAgent={!!rlTargetStrategy.code || !!generatedRlCode} progress={rlProgress} />;
          default: return null;
      }
  };

  return (
    <div className="h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500/30">
      <div className="flex flex-col min-w-0 h-full overflow-hidden relative">
        <header ref={headerRef} className="bg-slate-950/80 backdrop-blur border-b border-slate-800 flex flex-col z-10">
          <div className="h-16 flex items-center justify-between px-6">
            <div className="flex items-center space-x-6" style={{ marginLeft: dockHeaderOffset }}>
            <div><span className="text-xs text-slate-500 uppercase font-bold block">商品</span><span className="text-lg font-mono font-bold text-white">TXF1</span></div>
            <div className="h-8 w-px bg-slate-800"></div>
            <div><span className="text-xs text-slate-500 uppercase font-bold block">最新成交</span><span className={`text-lg font-mono font-bold ${data.length > 0 && data[data.length-1].close > data[data.length-1].open ? 'text-rose-400' : 'text-emerald-400'}`}>{data.length > 0 ? data[data.length-1].close.toFixed(0) : '---'}</span></div>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs text-emerald-500 font-bold bg-emerald-950/50 px-2 py-1 rounded">Backend Mode</span>
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-3 py-1.5">
              <span className="flex items-center text-[10px] text-slate-400">
                <span className={`inline-block w-2 h-2 rounded-full mr-1 ${marketStatus.state === 'RUNNING' ? 'bg-emerald-400' : marketStatus.state === 'STOPPED' ? 'bg-rose-400' : 'bg-slate-500'}`}></span>
                {marketStatus.state}
              </span>
              {marketStatusAt && (
                <span className="text-[10px] text-slate-500 font-mono">
                  {marketStatusAt.replace('T', ' ').slice(0, 19)}
                </span>
              )}
              <span className="text-[10px] text-slate-400">行情來源</span>
              <select
                value={marketSource}
                onChange={(e) => setMarketSource(e.target.value as MarketFeedSource)}
                className="bg-slate-950 text-[10px] text-slate-200 border border-slate-800 rounded px-2 py-0.5"
              >
                <option value="SIMULATED">模擬行情</option>
                <option value="REAL">真實行情 (預留)</option>
              </select>
              <button
                onClick={() => (marketStatus.state === 'RUNNING' ? stopMarketFeed() : startMarketFeed())}
                disabled={marketSource !== 'SIMULATED'}
                className={`text-[10px] px-2 py-0.5 rounded border ${
                  marketStatus.state === 'RUNNING'
                    ? 'border-emerald-500/50 text-emerald-300 hover:bg-emerald-600/20'
                    : 'border-indigo-500/50 text-indigo-300 hover:bg-indigo-600/20'
                } ${marketSource !== 'SIMULATED' ? 'opacity-40 cursor-not-allowed' : ''}`}
                title={marketSource === 'SIMULATED' ? '啟動/停止模擬行情' : '尚未接入真實行情'}
              >
                {marketStatus.state === 'RUNNING' ? '停止' : '啟動'}
              </button>
            </div>
            <button
              onClick={handleSaveLayout}
              className="p-2 rounded-full border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
              title="存檔佈局"
            >
              <Save size={14} />
            </button>
            <button
              onClick={handleResetLayout}
              className="p-2 rounded-full border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
              title="還原預設佈局"
            >
              <RotateCcw size={14} />
            </button>
            <button
              onClick={() => setActiveMode(activeMode === AppMode.DOCS ? lastNonDocsMode : AppMode.DOCS)}
              className="p-2 rounded-full border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800"
              title="線上說明書"
            >
              <BookOpen size={14} />
            </button>
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-800 rounded-full px-3 py-1.5">
              <span className="text-[10px] text-slate-300">{user ? (user.isGuest ? '訪客' : user.username) : '載入中...'}</span>
              <button onClick={() => setShowAuthModal(true)} className="text-indigo-300 hover:text-indigo-200 text-[10px]">
                {user?.isGuest ? '登入/註冊' : '切換'}
              </button>
            </div>
            <button onClick={handleSwitchGuest} className="text-[10px] text-slate-400 border border-slate-700 rounded-full px-3 py-1.5 hover:text-white hover:border-slate-600">
              切換訪客
            </button>
          </div>
          </div>
          {configWarnings.length > 0 && (
            <div className="px-6 pb-3">
              <div className="bg-amber-950/50 border border-amber-900/40 text-amber-200 text-xs rounded px-3 py-2 flex items-start justify-between gap-3">
                <div className="space-y-1">
                  {configWarnings.map((msg, idx) => (
                    <div key={`${msg}-${idx}`}>? {msg}</div>
                  ))}
                </div>
                <button onClick={() => setConfigWarnings([])} className="text-amber-300 hover:text-amber-100 text-xs">隱藏</button>
              </div>
            </div>
          )}
        </header>
        <main
          className="flex-1 overflow-y-auto p-4 scroll-smooth bg-slate-950 relative"
          style={{ paddingLeft: 16, paddingTop: 16 }}
        >
          {activeMode === AppMode.DOCS ? (
              <DocumentationWidget />
          ) : (
            <div ref={layoutContainerRef} className="relative pb-20" style={{ minHeight: layoutHeight }}>
                {(widgetOrder[activeMode] || layouts[activeMode] || DEFAULT_LAYOUTS[activeMode] || []).map((id, index) => (
                  <React.Fragment key={id}>{renderWidget(id, index)}</React.Fragment>
                ))}
            </div>
          )}
        </main>
        {activeMode !== AppMode.DOCS && (
          <div
            ref={dockRef}
            className="fixed z-20"
            style={{ left: dockPosition.x, top: dockPosition.y }}
          >
            <button
              ref={dockStartRef}
              onClick={() => setDockCollapsed((prev) => !prev)}
              className="flex items-center gap-2 px-3 py-2 rounded-md border border-slate-700/70 bg-slate-950/90 shadow-xl shadow-black/40 backdrop-blur-md text-slate-200 hover:text-white hover:bg-slate-800/90 transition-all"
              title={dockCollapsed ? '展開 Dock' : '最小化 Dock'}
            >
              <LayoutGrid size={16} />
              <span className="text-[11px] tracking-wide">開始</span>
            </button>
            {!dockCollapsed && (
              <div className="relative mt-2 grid grid-cols-2 gap-2 px-2 py-3 rounded-2xl border border-slate-700/60 bg-slate-900/80 shadow-xl shadow-black/40 backdrop-blur-md w-[200px] max-h-[70vh] overflow-y-auto">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    minimizeAllWidgets();
                  }}
                  className="flex flex-col items-center px-2 py-1 rounded-xl transition-all text-slate-300 hover:text-white hover:bg-slate-800/70"
                  title="全部最小化"
                >
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-slate-800/80">
                    <Minimize2 size={18} />
                  </div>
                  <span className="mt-1 text-[10px] max-w-[72px] truncate">全部最小化</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    cascadeWindows();
                  }}
                  className="flex flex-col items-center px-2 py-1 rounded-xl transition-all text-slate-300 hover:text-white hover:bg-slate-800/70"
                  title="Cascade Windows"
                >
                  <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-slate-800/80">
                    <Layers size={18} />
                  </div>
                  <span className="mt-1 text-[10px] max-w-[72px] truncate">Cascade</span>
                </button>
                {dockWidgetIds.map((id) => {
                  const meta = widgetMeta[id];
                  if (!meta) return null;
                  const Icon = meta.icon;
                  const activeIds = layouts[activeMode] || DEFAULT_LAYOUTS[activeMode] || [];
                  const targetMode = activeIds.includes(id) ? activeMode : (widgetModeMap[id] || activeMode);
                  const minimized = widgetMinimized[targetMode]?.[id] ?? true;
                  return (
                    <button
                      key={id}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (id === 'rlTraining' && !activeIds.includes(id)) {
                          openRlTraining();
                          return;
                        }
                        if ((id === 'aiControls' || id === 'codeEditor' || id === 'systemLog') && !activeIds.includes(id)) {
                          openAiLab();
                          return;
                        }
                        if (targetMode !== activeMode) setActiveMode(targetMode);
                        toggleWidgetMinimized(id, targetMode);
                      }}
                      className={`relative flex flex-col items-center px-2 py-1 rounded-xl transition-all ${
                        minimized
                          ? 'text-slate-400 hover:text-white hover:bg-slate-800/70'
                          : 'text-white bg-slate-800/80 border border-indigo-500/40 shadow-md shadow-indigo-900/20'
                      }`}
                      title={meta.title}
                    >
                      <div className={`flex items-center justify-center w-9 h-9 rounded-xl transition-all ${minimized ? 'bg-slate-800/80' : 'bg-indigo-600/20 border border-indigo-500/40'}`}>
                        <Icon size={18} />
                      </div>
                      <span className="mt-1 text-[10px] max-w-[72px] truncate">{meta.title}</span>
                      {!minimized && <span className="absolute -bottom-1 w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]"></span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {showAuthModal && (
          <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-30">
            <div className="w-full max-w-sm bg-slate-900 border border-slate-800 rounded-lg p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold text-sm">{authMode === 'login' ? '登入' : '註冊'}</h3>
                <button onClick={() => setShowAuthModal(false)} className="text-slate-400 hover:text-white text-xs">關閉</button>
              </div>
              <div className="flex gap-2 mb-4">
                <button
                  onClick={() => setAuthMode('login')}
                  className={`flex-1 text-xs py-1 rounded border ${authMode === 'login' ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-slate-700 text-slate-400'}`}
                >
                  登入
                </button>
                <button
                  onClick={() => setAuthMode('register')}
                  className={`flex-1 text-xs py-1 rounded border ${authMode === 'register' ? 'bg-emerald-600 border-emerald-500 text-white' : 'border-slate-700 text-slate-400'}`}
                >
                  註冊
                </button>
              </div>
              <div className="space-y-3">
                <input
                  value={authUsername}
                  onChange={(e) => setAuthUsername(e.target.value)}
                  placeholder="帳號"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200"
                />
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="密碼（至少 6 字）"
                  className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-xs text-slate-200"
                />
                {authError && <div className="text-rose-400 text-xs">{authError}</div>}
                <button
                  onClick={handleAuthSubmit}
                  className="w-full bg-indigo-600 hover:bg-indigo-500 text-white text-xs py-2 rounded"
                >
                  {authMode === 'login' ? '登入' : '建立帳號'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}












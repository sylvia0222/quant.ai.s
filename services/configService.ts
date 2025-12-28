import { AppConfig, StrategyTemplate } from '../types';

const CONFIG_URLS = [
  `${window.location.origin}/config/app.config.json`,
  'http://localhost:8000/config/app.config.json'
];

let cachedConfig: AppConfig | null = null;

const defaultConfig: AppConfig = {
  apiBase: 'http://localhost:8000',
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'qwen2.5:7b'
  },
  backend: {
    dbPath: 'quantai.db',
    corsOrigins: ['http://localhost:3000']
  },
  data: {
    timezone: 'Asia/Taipei',
    defaultFrequency: '1m',
    calendar: 'TAIFEX',
    pricePrecision: 2,
    volumePrecision: 0,
    loadDays: 30
  },
  quality: {
    maxMissingRatio: 0.01,
    maxGapSeconds: 120,
    maxOutlierZScore: 6.0,
    enforceMonotonicTime: true
  },
  backtest: {
    initialCapital: 1000000,
    slippageBps: 1.0,
    commissionBps: 1.5,
    taxBps: 0.0,
    benchmark: 'TXF',
    maxLookbackCandles: 600,
    optimizationWorkers: 2,
    intraday: {
      mode: 'BLOCK_AFTER_CLOSE',
      forceCloseTime: '13:41'
    },
    risk: {
      maxLeverage: 2.0,
      maxPositionRatio: 0.3,
      maxDrawdown: 0.2,
      stopLoss: 0.03,
      takeProfit: 0.06
    }
  },
  strategyTemplates: [
    {
      id: 'blank',
      name: '空白策略',
      description: '空白範本，請自行填入策略邏輯。',
      code: [
        'class MyStrategy:',
        '    def __init__(self):',
        '        self.position = 0',
        '',
        '    def on_tick(self, candles):',
        '        if len(candles) < 20:',
        '            return',
        '        c = candles[-1]',
        '        # TODO: 策略邏輯',
        '        return'
      ].join('\n')
    }
  ],
  monitoring: {
    enableMetrics: true,
    maxJobDurationSeconds: 7200,
    progressUpdateIntervalSeconds: 2
  }
};

const fetchConfigFromUrl = async (url: string): Promise<AppConfig | null> => {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as AppConfig;
  } catch {
    return null;
  }
};

const dispatchConfigWarnings = (warnings: string[]) => {
  if (warnings.length === 0) return;
  window.dispatchEvent(new CustomEvent('config:warning', { detail: warnings }));
};

const normalizeConfig = (raw: Partial<AppConfig> | null): AppConfig => {
  const merged: AppConfig = {
    ...defaultConfig,
    ...raw,
    ollama: { ...defaultConfig.ollama, ...(raw?.ollama || {}) },
    backend: { ...defaultConfig.backend, ...(raw?.backend || {}) },
    data: { ...defaultConfig.data, ...(raw?.data || {}) },
    quality: { ...defaultConfig.quality, ...(raw?.quality || {}) },
    backtest: {
      ...defaultConfig.backtest,
      ...(raw?.backtest || {}),
      risk: { ...defaultConfig.backtest.risk, ...(raw?.backtest?.risk || {}) }
    },
    strategyTemplates: Array.isArray(raw?.strategyTemplates) ? raw!.strategyTemplates! : defaultConfig.strategyTemplates,
    monitoring: { ...defaultConfig.monitoring, ...(raw?.monitoring || {}) }
  };

  const warnings: string[] = [];
  if (!merged.apiBase || typeof merged.apiBase !== 'string') {
    warnings.push('設定檔 apiBase 缺失或格式錯誤，已回退為預設值。');
    merged.apiBase = defaultConfig.apiBase;
  }
  if (!merged.ollama?.baseUrl || typeof merged.ollama.baseUrl !== 'string') {
    warnings.push('設定檔 ollama.baseUrl 缺失或格式錯誤，已回退為預設值。');
    merged.ollama.baseUrl = defaultConfig.ollama.baseUrl;
  }
  if (!merged.ollama?.model || typeof merged.ollama.model !== 'string') {
    warnings.push('設定檔 ollama.model 缺失或格式錯誤，已回退為預設值。');
    merged.ollama.model = defaultConfig.ollama.model;
  }
  if (!merged.backend?.dbPath || typeof merged.backend.dbPath !== 'string') {
    warnings.push('設定檔 backend.dbPath 缺失或格式錯誤，已回退為預設值。');
    merged.backend.dbPath = defaultConfig.backend.dbPath;
  }
  if (!Array.isArray(merged.backend?.corsOrigins)) {
    warnings.push('設定檔 backend.corsOrigins 缺失或格式錯誤，已回退為預設值。');
    merged.backend.corsOrigins = defaultConfig.backend.corsOrigins;
  }
  if (!merged.data?.timezone || typeof merged.data.timezone !== 'string') {
    warnings.push('設定檔 data.timezone 缺失或格式錯誤，已回退為預設值。');
    merged.data.timezone = defaultConfig.data.timezone;
  }
  if (!merged.data?.defaultFrequency || typeof merged.data.defaultFrequency !== 'string') {
    warnings.push('設定檔 data.defaultFrequency 缺失或格式錯誤，已回退為預設值。');
    merged.data.defaultFrequency = defaultConfig.data.defaultFrequency;
  }
  if (!merged.data?.calendar || typeof merged.data.calendar !== 'string') {
    warnings.push('設定檔 data.calendar 缺失或格式錯誤，已回退為預設值。');
    merged.data.calendar = defaultConfig.data.calendar;
  }
  if (typeof merged.data?.pricePrecision !== 'number') {
    warnings.push('設定檔 data.pricePrecision 缺失或格式錯誤，已回退為預設值。');
    merged.data.pricePrecision = defaultConfig.data.pricePrecision;
  }
  if (typeof merged.data?.volumePrecision !== 'number') {
    warnings.push('設定檔 data.volumePrecision 缺失或格式錯誤，已回退為預設值。');
    merged.data.volumePrecision = defaultConfig.data.volumePrecision;
  }
  if (typeof merged.data?.loadDays !== 'number') {
    warnings.push('設定檔 data.loadDays 缺失或格式錯誤，已回退為預設值。');
    merged.data.loadDays = defaultConfig.data.loadDays;
  } else if (merged.data.loadDays < 1) {
    warnings.push('設定檔 data.loadDays 不得小於 1，已回退為預設值。');
    merged.data.loadDays = defaultConfig.data.loadDays;
  }
  if (typeof merged.quality?.maxMissingRatio !== 'number') {
    warnings.push('設定檔 quality.maxMissingRatio 缺失或格式錯誤，已回退為預設值。');
    merged.quality.maxMissingRatio = defaultConfig.quality.maxMissingRatio;
  }
  if (typeof merged.quality?.maxGapSeconds !== 'number') {
    warnings.push('設定檔 quality.maxGapSeconds 缺失或格式錯誤，已回退為預設值。');
    merged.quality.maxGapSeconds = defaultConfig.quality.maxGapSeconds;
  }
  if (typeof merged.quality?.maxOutlierZScore !== 'number') {
    warnings.push('設定檔 quality.maxOutlierZScore 缺失或格式錯誤，已回退為預設值。');
    merged.quality.maxOutlierZScore = defaultConfig.quality.maxOutlierZScore;
  }
  if (typeof merged.quality?.enforceMonotonicTime !== 'boolean') {
    warnings.push('設定檔 quality.enforceMonotonicTime 缺失或格式錯誤，已回退為預設值。');
    merged.quality.enforceMonotonicTime = defaultConfig.quality.enforceMonotonicTime;
  }
  if (typeof merged.backtest?.initialCapital !== 'number') {
    warnings.push('設定檔 backtest.initialCapital 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.initialCapital = defaultConfig.backtest.initialCapital;
  }
  if (typeof merged.backtest?.slippageBps !== 'number') {
    warnings.push('設定檔 backtest.slippageBps 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.slippageBps = defaultConfig.backtest.slippageBps;
  }
  if (typeof merged.backtest?.commissionBps !== 'number') {
    warnings.push('設定檔 backtest.commissionBps 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.commissionBps = defaultConfig.backtest.commissionBps;
  }
  if (typeof merged.backtest?.taxBps !== 'number') {
    warnings.push('設定檔 backtest.taxBps 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.taxBps = defaultConfig.backtest.taxBps;
  }
  if (!merged.backtest?.benchmark || typeof merged.backtest.benchmark !== 'string') {
    warnings.push('設定檔 backtest.benchmark 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.benchmark = defaultConfig.backtest.benchmark;
  }
  if (typeof merged.backtest?.maxLookbackCandles !== 'number') {
    warnings.push('設定檔 backtest.maxLookbackCandles 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.maxLookbackCandles = defaultConfig.backtest.maxLookbackCandles;
  }
  if (typeof merged.backtest?.optimizationWorkers !== 'number') {
    warnings.push('設定檔 backtest.optimizationWorkers 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.optimizationWorkers = defaultConfig.backtest.optimizationWorkers;
  } else if (merged.backtest.optimizationWorkers < 1) {
    warnings.push('設定檔 backtest.optimizationWorkers 不得小於 1，已回退為預設值。');
    merged.backtest.optimizationWorkers = defaultConfig.backtest.optimizationWorkers;
  }
  if (!merged.backtest?.intraday || typeof merged.backtest.intraday !== 'object') {
    warnings.push('設定檔 backtest.intraday 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.intraday = defaultConfig.backtest.intraday;
  } else {
    const mode = merged.backtest.intraday.mode;
    if (mode !== 'BLOCK_AFTER_CLOSE' && mode !== 'FORCE_CLOSE_AT_TIME') {
      warnings.push('設定檔 backtest.intraday.mode 格式錯誤，已回退為預設值。');
      merged.backtest.intraday.mode = defaultConfig.backtest.intraday.mode;
    }
    if (typeof merged.backtest.intraday.forceCloseTime !== 'string') {
      warnings.push('設定檔 backtest.intraday.forceCloseTime 缺失或格式錯誤，已回退為預設值。');
      merged.backtest.intraday.forceCloseTime = defaultConfig.backtest.intraday.forceCloseTime;
    }
  }
  if (typeof merged.backtest?.risk?.maxLeverage !== 'number') {
    warnings.push('設定檔 backtest.risk.maxLeverage 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.risk.maxLeverage = defaultConfig.backtest.risk.maxLeverage;
  }
  if (typeof merged.backtest?.risk?.maxPositionRatio !== 'number') {
    warnings.push('設定檔 backtest.risk.maxPositionRatio 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.risk.maxPositionRatio = defaultConfig.backtest.risk.maxPositionRatio;
  }
  if (typeof merged.backtest?.risk?.maxDrawdown !== 'number') {
    warnings.push('設定檔 backtest.risk.maxDrawdown 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.risk.maxDrawdown = defaultConfig.backtest.risk.maxDrawdown;
  }
  if (typeof merged.backtest?.risk?.stopLoss !== 'number') {
    warnings.push('設定檔 backtest.risk.stopLoss 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.risk.stopLoss = defaultConfig.backtest.risk.stopLoss;
  }
  if (typeof merged.backtest?.risk?.takeProfit !== 'number') {
    warnings.push('設定檔 backtest.risk.takeProfit 缺失或格式錯誤，已回退為預設值。');
    merged.backtest.risk.takeProfit = defaultConfig.backtest.risk.takeProfit;
  }
  if (!Array.isArray(merged.strategyTemplates)) {
    warnings.push('設定檔 strategyTemplates 缺失或格式錯誤，已回退為預設值。');
    merged.strategyTemplates = defaultConfig.strategyTemplates;
  }
  if (typeof merged.monitoring?.enableMetrics !== 'boolean') {
    warnings.push('設定檔 monitoring.enableMetrics 缺失或格式錯誤，已回退為預設值。');
    merged.monitoring.enableMetrics = defaultConfig.monitoring.enableMetrics;
  }
  if (typeof merged.monitoring?.maxJobDurationSeconds !== 'number') {
    warnings.push('設定檔 monitoring.maxJobDurationSeconds 缺失或格式錯誤，已回退為預設值。');
    merged.monitoring.maxJobDurationSeconds = defaultConfig.monitoring.maxJobDurationSeconds;
  }
  if (typeof merged.monitoring?.progressUpdateIntervalSeconds !== 'number') {
    warnings.push('設定檔 monitoring.progressUpdateIntervalSeconds 缺失或格式錯誤，已回退為預設值。');
    merged.monitoring.progressUpdateIntervalSeconds = defaultConfig.monitoring.progressUpdateIntervalSeconds;
  }

  dispatchConfigWarnings(warnings);
  return merged;
};

export const getAppConfig = async (): Promise<AppConfig> => {
  if (cachedConfig) return cachedConfig;
  for (const url of CONFIG_URLS) {
    const cfg = await fetchConfigFromUrl(url);
    if (cfg) {
      cachedConfig = normalizeConfig(cfg);
      return cachedConfig;
    }
  }
  cachedConfig = normalizeConfig(defaultConfig);
  return cachedConfig;
};

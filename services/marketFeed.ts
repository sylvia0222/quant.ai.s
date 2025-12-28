import { Candle, MarketDataEventHandler, MarketDataEventType, MarketDataFeed, MarketFeedStatus, MarketSnapshot } from '../types';
import { generateNextCandle } from './marketData';

interface SimulatedMarketFeedOptions {
  seedCandles: Candle[];
  intervalMs?: number;
  maxCandles?: number;
}

export class SimulatedMarketFeed implements MarketDataFeed {
  private candles: Candle[];
  private intervalMs: number;
  private maxCandles: number;
  private timer: number | null = null;
  private listeners: Map<MarketDataEventType, Set<MarketDataEventHandler>> = new Map();

  constructor(options: SimulatedMarketFeedOptions) {
    this.candles = options.seedCandles.slice();
    this.intervalMs = Math.max(200, options.intervalMs ?? 1000);
    this.maxCandles = Math.max(200, options.maxCandles ?? 2000);
  }

  start() {
    if (this.timer !== null) return;
    if (this.candles.length === 0) {
      this.emit('error', { type: 'error', error: '缺少起始行情資料，無法啟動模擬。' });
      return;
    }
    this.timer = window.setInterval(() => {
      const last = this.candles[this.candles.length - 1];
      const next = generateNextCandle(last);
      this.candles.push(next);
      if (this.candles.length > this.maxCandles) {
        this.candles.shift();
      }
      this.emit('candle', { type: 'candle', candle: next });
    }, this.intervalMs);
    this.emitStatus('RUNNING', '模擬行情已啟動。');
  }

  stop() {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
    this.emitStatus('STOPPED', '模擬行情已停止。');
  }

  isRunning() {
    return this.timer !== null;
  }

  getSnapshot(): MarketSnapshot | null {
    if (this.candles.length === 0) return null;
    return {
      candles: this.candles.slice(),
      latest: this.candles[this.candles.length - 1],
      source: 'SIMULATED',
      updatedAt: new Date().toISOString()
    };
  }

  on<T extends MarketDataEventType>(type: T, handler: MarketDataEventHandler<T>) {
    const bucket = this.listeners.get(type) ?? new Set();
    bucket.add(handler as MarketDataEventHandler);
    this.listeners.set(type, bucket);
    return () => {
      const next = this.listeners.get(type);
      if (!next) return;
      next.delete(handler as MarketDataEventHandler);
      if (next.size === 0) this.listeners.delete(type);
    };
  }

  updateSeed(seedCandles: Candle[]) {
    this.candles = seedCandles.slice();
    const snapshot = this.getSnapshot();
    if (snapshot) {
      this.emit('snapshot', { type: 'snapshot', snapshot });
    }
  }

  private emit<T extends MarketDataEventType>(type: T, payload: Parameters<MarketDataEventHandler<T>>[0]) {
    const bucket = this.listeners.get(type);
    if (!bucket) return;
    bucket.forEach((handler) => handler(payload as any));
  }

  private emitStatus(state: MarketFeedStatus['state'], message?: string) {
    this.emit('status', {
      type: 'status',
      status: { state, source: 'SIMULATED', message }
    });
  }
}



import { Candle, OrderBook, OrderBookLevel } from '../types';

export interface CandleMeta {
  symbol: string;
  frequency: string;
  timezone: string;
  exchange?: string;
}

const resolveMeta = (meta?: Partial<CandleMeta>): CandleMeta => ({
  symbol: meta?.symbol || 'TXF',
  frequency: meta?.frequency || '1m',
  timezone: meta?.timezone || 'Asia/Taipei',
  exchange: meta?.exchange || 'TWSE'
});

// Helper to format date as YYYY-MM-DD HH:mm
const formatTime = (date: Date): string => {
  const yyyy = date.getFullYear();
  const mm = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd = date.getDate().toString().padStart(2, '0');
  const hh = date.getHours().toString().padStart(2, '0');
  const min = date.getMinutes().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
};

// Parse YYYY-MM-DD to Date object set at 00:00:00
const parseDateString = (dateStr: string): Date => {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// --- Level 2 Simulation Helpers ---

// State to track "Liquidity Walls" (Persistent large orders)
let liquidityWalls: { price: number, volume: number, type: 'BID' | 'ASK' }[] = [];

const updateLiquidityWalls = (currentPrice: number) => {
    // 1. Remove walls that are too far away or randomly expire
    liquidityWalls = liquidityWalls.filter(w => {
        const dist = Math.abs(w.price - currentPrice);
        return dist < 150 && Math.random() > 0.05; // 5% chance to disappear per minute
    });

    // 2. Add new walls if needed
    if (liquidityWalls.length < 4) {
        const type = Math.random() > 0.5 ? 'BID' : 'ASK';
        const offset = 20 + Math.random() * 80;
        const price = Math.round(currentPrice + (type === 'ASK' ? offset : -offset));
        // Wall volume: 500 - 2000 lots
        const volume = 500 + Math.floor(Math.random() * 1500); 
        liquidityWalls.push({ price, volume, type });
    }
};

const generateOrderBook = (closePrice: number): OrderBook => {
    const bids: OrderBookLevel[] = [];
    const asks: OrderBookLevel[] = [];

    // Basic Spread
    const spread = 1; 

    // Generate Best 5 Bids
    for (let i = 0; i < 5; i++) {
        const price = Math.floor(closePrice - spread - i);
        // Base volume noise
        let volume = 10 + Math.floor(Math.random() * 50); 
        
        // Check if there is a wall nearby
        const wall = liquidityWalls.find(w => w.type === 'BID' && Math.abs(w.price - price) <= 1);
        if (wall) volume += wall.volume;

        bids.push({ price, volume });
    }

    // Generate Best 5 Asks
    for (let i = 0; i < 5; i++) {
        const price = Math.ceil(closePrice + spread + i);
        // Base volume noise
        let volume = 10 + Math.floor(Math.random() * 50);

        // Check if there is a wall nearby
        const wall = liquidityWalls.find(w => w.type === 'ASK' && Math.abs(w.price - price) <= 1);
        if (wall) volume += wall.volume;

        asks.push({ price, volume });
    }

    return { bids, asks };
};

export const generateInitialData = (days: number = 3, meta?: Partial<CandleMeta>): Candle[] => {
  // Reset simulation state
  liquidityWalls = [];
  
  const today = new Date();
  const start = new Date(today);
  const safeDays = Math.max(1, Math.floor(days));
  start.setDate(today.getDate() - (safeDays - 1));
  
  const startStr = start.toISOString().split('T')[0];
  const endStr = today.toISOString().split('T')[0];

  return generateHistoricalData(startStr, endStr, meta); 
};

export const generateHistoricalData = (startDateStr: string, endDateStr: string, meta?: Partial<CandleMeta>): Candle[] => {
  const data: Candle[] = [];
  let currentPrice = 16000 + Math.random() * 2000;
  liquidityWalls = []; // Reset walls for new history
  const resolvedMeta = resolveMeta(meta);
  
  const startDate = parseDateString(startDateStr);
  const endDate = parseDateString(endDateStr);
  
  if (startDate > endDate) {
      return [];
  }

  const loopDate = new Date(startDate);
  
  while (loopDate <= endDate) {
    if (data.length > 0) { 
        const gap = (Math.random() - 0.5) * 150; 
        currentPrice += gap;
    }

    let trend = (Math.random() - 0.5) * 1.0; 

    for (let m = 0; m <= 300; m++) {
        const time = new Date(loopDate);
        time.setHours(8, 45 + m, 0, 0);

        trend += (Math.random() - 0.5) * 0.1; 
        const volatility = 5 + Math.random() * 10;
        const noise = (Math.random() - 0.5) * volatility;
        const change = trend + noise;

        const open = currentPrice;
        const close = currentPrice + change;
        
        const high = Math.max(open, close) + Math.random() * 3;
        const low = Math.min(open, close) - Math.random() * 3;
        const volume = Math.floor(Math.abs(change) * 30) + Math.floor(Math.random() * 300) + 50;

        // Update synthetic walls based on new price
        updateLiquidityWalls(close);

        data.push({
            symbol: resolvedMeta.symbol,
            time: formatTime(time),
            frequency: resolvedMeta.frequency,
            timezone: resolvedMeta.timezone,
            exchange: resolvedMeta.exchange,
            open,
            high,
            low,
            close,
            volume,
            orderBook: generateOrderBook(close) // Generate L2 Data
        });

        currentPrice = close;
    }

    loopDate.setDate(loopDate.getDate() + 1);
  }

  return data;
};

export const generateNextCandle = (lastCandle: Candle): Candle => {
  const [datePart, timePart] = lastCandle.time.split(' ');
  const [yearStr, monthStr, dayStr] = datePart.split('-');
  const [hour, minute] = timePart.split(':').map(Number);

  const lastDate = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr), hour, minute);
  
  let nextDate = new Date(lastDate.getTime() + 60000); // +1 minute

  const nextHour = nextDate.getHours();
  const nextMin = nextDate.getMinutes();
  
  let isGapOpen = false;

  if (nextHour > 13 || (nextHour === 13 && nextMin > 45)) {
      nextDate.setDate(nextDate.getDate() + 1);
      nextDate.setHours(8, 45, 0, 0);
      isGapOpen = true;
  } 
  else if (nextHour < 8 || (nextHour === 8 && nextMin < 45)) {
      nextDate.setHours(8, 45, 0, 0);
      isGapOpen = true;
  }

  let lastClose = lastCandle.close;
  
  if (isGapOpen) {
      lastClose += (Math.random() - 0.5) * 100;
  }

  const volatility = 8 + Math.random() * 12;
  const change = (Math.random() - 0.5) * volatility;
  
  const open = lastClose;
  const close = lastClose + change;
  const high = Math.max(open, close) + Math.random() * 4;
  const low = Math.min(open, close) - Math.random() * 4;
  const volume = Math.floor(Math.random() * 300) + 20;

  // Simulate dynamic walls during streaming
  updateLiquidityWalls(close);

  return {
    symbol: lastCandle.symbol,
    time: formatTime(nextDate),
    frequency: lastCandle.frequency,
    timezone: lastCandle.timezone,
    exchange: lastCandle.exchange,
    open,
    high,
    low,
    close,
    volume,
    orderBook: generateOrderBook(close)
  };
};



import { Trade, CostConfig } from '../types';

// --- COST CONSTANTS ---
export const DEFAULT_COSTS: CostConfig = {
  POINT_VALUE: 200,      // TXF 1 point = 200 TWD
  TAX_RATE: 0.00002,     // 0.002% Transaction Tax
  COMMISSION: 50,        // 50 TWD per lot per side
  SLIPPAGE: 1            // 1 point slippage per execution
};

// Kept for backward compatibility if needed, though mostly replaced by DEFAULT_COSTS
export const COSTS = DEFAULT_COSTS;

export const processTradeLogic = (
    side: 'BUY' | 'SELL', 
    rawPrice: number, 
    size: number, 
    time: string, 
    idPrefix: string,
    currentPos: {size: number, avgPrice: number}, 
    note?: string,
    costs: CostConfig = DEFAULT_COSTS,
    useSlippage: boolean = true
) => {
    // 1. Calculate Execution Price (Slippage)
    // Buy at Ask (Market + Slippage), Sell at Bid (Market - Slippage)
    const execPrice = useSlippage
        ? (side === 'BUY' ? rawPrice + costs.SLIPPAGE : rawPrice - costs.SLIPPAGE)
        : rawPrice;

    // 2. Calculate Transaction Fees (Tax + Commission)
    // Tax: Based on contract value
    const tax = Math.round(execPrice * costs.POINT_VALUE * size * costs.TAX_RATE);
    const commission = costs.COMMISSION * size;
    const fees = commission + tax;

    let newSize = currentPos.size;
    let newAvgPrice = currentPos.avgPrice;
    let realizedGrossPnL = 0;
    
    const tradeSign = side === 'BUY' ? 1 : -1;
    const tradeQty = size * tradeSign;
    const isClosing = (currentPos.size > 0 && side === 'SELL') || (currentPos.size < 0 && side === 'BUY');
    
    if (isClosing) {
        const closeQty = Math.min(Math.abs(currentPos.size), size);
        
        // Gross PnL (Diff between Exec Price and Avg Price)
        if (currentPos.size > 0) { // Long close
           realizedGrossPnL = (execPrice - currentPos.avgPrice) * closeQty * costs.POINT_VALUE;
        } else { // Short close
           realizedGrossPnL = (currentPos.avgPrice - execPrice) * closeQty * costs.POINT_VALUE;
        }

        newSize += tradeQty; 
        
        // Reversal Logic: If flipped, the remainder determines the new AvgPrice
        if ((currentPos.size > 0 && newSize < 0) || (currentPos.size < 0 && newSize > 0)) {
           newAvgPrice = execPrice;
        } else if (newSize === 0) {
           newAvgPrice = 0;
        }
    } else {
        // Opening or Adding
        const totalValue = (Math.abs(currentPos.size) * currentPos.avgPrice) + (size * execPrice);
        const totalSize = Math.abs(currentPos.size) + size;
        newAvgPrice = totalValue / totalSize;
        newSize += tradeQty;
    }

    const netPnL = realizedGrossPnL - fees;

    const trade: Trade = {
        id: `${idPrefix}-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
        symbol: 'TXF',
        side, 
        price: execPrice, 
        size, 
        time, 
        status: 'CLOSED',
        pnl: netPnL,
        positionAfter: newSize, 
        note
    };
    
    return { trade, newPos: { size: newSize, avgPrice: newAvgPrice }, realizedGrossPnL, fees, tax, commission, netPnL };
};

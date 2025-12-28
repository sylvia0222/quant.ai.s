

import { Candle } from '../types';

let db: any = null;
let SQL: any = null;

// IndexedDB Configuration
const DB_NAME = "QuantAI_Storage";
const STORE_NAME = "files";
const FILE_KEY = "market_data.sqlite";

// Helper: Open IndexedDB
const openIDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (event: any) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = (event: any) => resolve(event.target.result);
        request.onerror = (event: any) => reject(event.target.error);
    });
};

// Helper: Save binary to IndexedDB
const persistToStorage = async () => {
    if (!db) return;
    try {
        const binary = db.export(); // Get Uint8Array
        const idb = await openIDB();
        const tx = idb.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.put(binary, FILE_KEY);
    } catch (e) {
        console.error("Failed to persist DB to IndexedDB:", e);
    }
};

// Helper: Load binary from IndexedDB
const loadFromStorage = async (): Promise<Uint8Array | null> => {
    try {
        const idb = await openIDB();
        return new Promise((resolve, reject) => {
            const tx = idb.transaction(STORE_NAME, "readonly");
            const store = tx.objectStore(STORE_NAME);
            const request = store.get(FILE_KEY);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    } catch (e) {
        console.error("Failed to load DB from IndexedDB:", e);
        return null;
    }
};

// Helper: Delete from IndexedDB
const clearStorage = async () => {
    try {
        const idb = await openIDB();
        const tx = idb.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.delete(FILE_KEY);
    } catch (e) {
        console.error("Failed to clear IndexedDB:", e);
    }
};

// Initialize SQL.js and Database
export const initDB = async () => {
  if (db) return;
  
  if (!(window as any).initSqlJs) {
      console.error("SQL.js script not found in window");
      return;
  }

  try {
      SQL = await (window as any).initSqlJs({
        locateFile: (file: string) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/${file}`
      });

      const savedBinary = await loadFromStorage();

      if (savedBinary) {
          db = new SQL.Database(savedBinary);
          console.log("SQLite DB restored from IndexedDB");
      } else {
          db = new SQL.Database();
          console.log("New SQLite DB initialized");
      }
      
      // Update Schema: Added level2_json column
      // We use IF NOT EXISTS, but to handle migration of existing DBs without the column, 
      // we might need to alter. For simplicity in this demo, we assume fresh start or permissive read.
      db.run(`
        CREATE TABLE IF NOT EXISTS candles (
          symbol TEXT,
          time TEXT,
          frequency TEXT,
          timezone TEXT,
          exchange TEXT,
          open REAL,
          high REAL,
          low REAL,
          close REAL,
          volume INTEGER,
          level2_json TEXT,
          PRIMARY KEY (symbol, time, frequency)
        );
      `);
      
      try {
          db.exec("SELECT symbol, frequency, timezone FROM candles LIMIT 1");
      } catch (e) {
          console.log("Migrating table to include symbol/frequency/timezone...");
          db.run("ALTER TABLE candles RENAME TO candles_legacy");
          db.run(`
            CREATE TABLE candles (
              symbol TEXT,
              time TEXT,
              frequency TEXT,
              timezone TEXT,
              exchange TEXT,
              open REAL,
              high REAL,
              low REAL,
              close REAL,
              volume INTEGER,
              level2_json TEXT,
              PRIMARY KEY (symbol, time, frequency)
            );
          `);
          db.run(`
            INSERT INTO candles (symbol, time, frequency, timezone, exchange, open, high, low, close, volume, level2_json)
            SELECT 'TXF', time, '1m', 'Asia/Taipei', 'TWSE', open, high, low, close, volume, level2_json
            FROM candles_legacy;
          `);
          db.run("DROP TABLE candles_legacy");
      }
      
  } catch (e) {
      console.error("Failed to init SQLite:", e);
      throw e;
  }
};

// Bulk Insert / Update
export const saveCandles = (candles: Candle[]) => {
    if (!db) return;
    try {
        db.run("BEGIN TRANSACTION");
        // Updated query to include level2_json
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO candles
            (symbol, time, frequency, timezone, exchange, open, high, low, close, volume, level2_json)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `);
        for (const c of candles) {
            const l2 = c.orderBook ? JSON.stringify(c.orderBook) : null;
            stmt.run([c.symbol, c.time, c.frequency, c.timezone, c.exchange || null, c.open, c.high, c.low, c.close, c.volume, l2]);
        }
        stmt.free();
        db.run("COMMIT");
        
        persistToStorage();
    } catch (e) {
        console.error("DB Save Error:", e);
        db.run("ROLLBACK");
    }
}

// Retrieve All Data Sorted by Time
export const getAllCandles = (): Candle[] => {
    if (!db) return [];
    try {
        const res = db.exec("SELECT * FROM candles ORDER BY time ASC");
        if (res.length === 0) return [];
        
        const rows = res[0].values;
        return rows.map((row: any) => ({
            symbol: row[0],
            time: row[1],
            frequency: row[2],
            timezone: row[3],
            exchange: row[4] || undefined,
            open: row[5],
            high: row[6],
            low: row[7],
            close: row[8],
            volume: row[9],
            orderBook: row[10] ? JSON.parse(row[10]) : undefined
        }));
    } catch (e) {
        console.error("DB Read Error:", e);
        return [];
    }
}

// Check if DB has data
export const hasData = (): boolean => {
    if (!db) return false;
    try {
        const res = db.exec("SELECT count(*) FROM candles");
        return res[0].values[0][0] > 0;
    } catch {
        return false;
    }
}

// Clear Table & Persistence
export const clearCandles = () => {
    if (!db) return;
    db.run("DELETE FROM candles");
    clearStorage(); 
}

// Export DB as binary array
export const exportDB = (): Uint8Array | null => {
    if (!db) return null;
    return db.export();
}

// Import DB from binary array
export const importDB = (buffer: ArrayBuffer) => {
    if (!SQL) return;
    if (db) db.close();
    
    try {
        db = new SQL.Database(new Uint8Array(buffer));
        // Ensure schema
        db.run(`
            CREATE TABLE IF NOT EXISTS candles (
              symbol TEXT,
              time TEXT,
              frequency TEXT,
              timezone TEXT,
              exchange TEXT,
              open REAL,
              high REAL,
              low REAL,
              close REAL,
              volume INTEGER,
              level2_json TEXT,
              PRIMARY KEY (symbol, time, frequency)
            );
          `);
        
        persistToStorage();
    } catch (e) {
        console.error("DB Import Error:", e);
        throw e;
    }
}


import { BacktestRun, Candle, MarketScope, Strategy, SystemSettings, TaskStatus, UserProfile } from '../types';
import { getAppConfig } from './configService';

const AUTH_TOKEN_KEY = 'quantai_auth_token';
const GUEST_ID_KEY = 'quantai_guest_id';

const getToken = () => localStorage.getItem(AUTH_TOKEN_KEY);
export const setToken = (token: string | null) => {
    if (token) localStorage.setItem(AUTH_TOKEN_KEY, token);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
};

const handleJson = async <T>(res: Response): Promise<T> => {
    if (!res.ok) {
        const message = await res.text();
        throw new Error(message || `Request failed (${res.status})`);
    }
    return res.json() as Promise<T>;
};

const fetchWithAuth = async (input: RequestInfo, init?: RequestInit) => {
    const token = getToken();
    const headers = new Headers(init?.headers || {});
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
};

const buildCandleQuery = async (scope?: MarketScope, days?: number) => {
    const config = await getAppConfig();
    const resolved = scope || {
        symbol: config.backtest.benchmark,
        frequency: config.data.defaultFrequency,
        timezone: config.data.timezone,
        exchange: config.data.calendar
    };
    const params = new URLSearchParams({
        symbol: resolved.symbol,
        frequency: resolved.frequency,
        timezone: resolved.timezone,
        exchange: resolved.exchange || ''
    });
    if (typeof days === 'number' && days > 0) {
        params.set('days', String(Math.floor(days)));
    }
    return `?${params.toString()}`;
};

export const api = {
    getToken,
    setToken,

    // --- Auth ---
    async register(username: string, password: string): Promise<UserProfile> {
        const config = await getAppConfig();
        const res = await fetch(`${config.apiBase}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await handleJson<{ token: string; user: UserProfile }>(res);
        setToken(data.token);
        return data.user;
    },

    async login(username: string, password: string): Promise<UserProfile> {
        const config = await getAppConfig();
        const res = await fetch(`${config.apiBase}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await handleJson<{ token: string; user: UserProfile }>(res);
        setToken(data.token);
        return data.user;
    },

    async guest(): Promise<UserProfile> {
        const config = await getAppConfig();
        let guestId = localStorage.getItem(GUEST_ID_KEY);
        if (!guestId) {
            guestId = Math.random().toString(36).slice(2);
            localStorage.setItem(GUEST_ID_KEY, guestId);
        }
        const res = await fetch(`${config.apiBase}/api/auth/guest`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guestId })
        });
        const data = await handleJson<{ token: string; user: UserProfile }>(res);
        setToken(data.token);
        return data.user;
    },

    async me(): Promise<UserProfile | null> {
        const config = await getAppConfig();
        const res = await fetchWithAuth(`${config.apiBase}/api/auth/me`);
        if (!res.ok) return null;
        return handleJson<UserProfile>(res);
    },

    // --- Market Data (FastAPI + SQLite) ---
    async fetchCandles(scope?: MarketScope, days?: number): Promise<Candle[]> {
        try {
            const config = await getAppConfig();
            const query = await buildCandleQuery(scope, days);
            const res = await fetchWithAuth(`${config.apiBase}/api/candles${query}`);
            return await handleJson<Candle[]>(res);
        } catch (e) {
            console.error("Failed to fetch candles from backend:", e);
            return [];
        }
    },

    async saveCandles(candles: Candle[]): Promise<boolean> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/candles`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(candles)
            });
            await handleJson(res);
            return true;
        } catch (e) {
            console.error("Failed to save candles to backend:", e);
            return false;
        }
    },

    async clearCandles(scope?: MarketScope): Promise<boolean> {
        try {
            const config = await getAppConfig();
            const query = await buildCandleQuery(scope);
            const res = await fetchWithAuth(`${config.apiBase}/api/candles${query}`, { method: 'DELETE' });
            await handleJson(res);
            return true;
        } catch (e) {
            console.error("Failed to clear backend DB:", e);
            return false;
        }
    },

    // --- Strategies ---
    async fetchStrategies(): Promise<Strategy[]> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/strategies`);
            return await handleJson<Strategy[]>(res);
        } catch (e) {
            console.error("Failed to load strategies:", e);
            return [];
        }
    },

    async saveStrategies(strategies: Strategy[]): Promise<boolean> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/strategies`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(strategies)
            });
            await handleJson(res);
            return true;
        } catch (e) {
            console.error("Failed to save strategies:", e);
            return false;
        }
    },

    async seedStrategies(): Promise<Strategy[]> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/strategies/seed`, {
                method: 'POST'
            });
            return await handleJson<Strategy[]>(res);
        } catch (e) {
            console.error("Failed to seed strategies:", e);
            return [];
        }
    },

    // --- System Settings ---
    async fetchSettings(): Promise<SystemSettings | null> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/settings`);
            const data = await handleJson<SystemSettings>(res);
            if (!data || Object.keys(data).length === 0) return null;
            return data;
        } catch (e) {
            console.error("Failed to fetch settings:", e);
            return null;
        }
    },

    async saveSettings(settings: SystemSettings): Promise<boolean> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/settings`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings })
            });
            await handleJson(res);
            return true;
        } catch (e) {
            console.error("Failed to save settings:", e);
            return false;
        }
    },

    // --- Backtest Summaries ---
    async fetchBacktests(): Promise<BacktestRun[]> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/backtests`);
            return await handleJson<BacktestRun[]>(res);
        } catch (e) {
            console.error("Failed to fetch backtests:", e);
            return [];
        }
    },

    async saveBacktests(backtests: BacktestRun[]): Promise<boolean> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/backtests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(backtests)
            });
            await handleJson(res);
            return true;
        } catch (e) {
            console.error("Failed to save backtests:", e);
            return false;
        }
    },

    async clearBacktests(): Promise<boolean> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/backtests`, { method: 'DELETE' });
            await handleJson(res);
            return true;
        } catch (e) {
            console.error("Failed to clear backtests:", e);
            return false;
        }
    },

    async logout() {
        setToken(null);
    },

    async fetchConfig(): Promise<any | null> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/config`);
            return await handleJson(res);
        } catch (e) {
            console.error("Failed to fetch config:", e);
            return null;
        }
    },

    async saveConfig(nextConfig: any): Promise<{ ok: boolean; warning?: string } | null> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/config`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(nextConfig)
            });
            return await handleJson(res);
        } catch (e) {
            console.error("Failed to save config:", e);
            return null;
        }
    },

    async fetchTasks(): Promise<TaskStatus[]> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/tasks`);
            return await handleJson<TaskStatus[]>(res);
        } catch (e) {
            console.error("Failed to fetch tasks:", e);
            return [];
        }
    },

    async startTask(name: string): Promise<string | null> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/tasks/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });
            const data = await handleJson<{ id: string }>(res);
            return data.id;
        } catch (e) {
            console.error("Failed to start task:", e);
            return null;
        }
    },

    async updateTask(id: string, status: string, progress: number, error?: string): Promise<boolean> {
        try {
            const config = await getAppConfig();
            const res = await fetchWithAuth(`${config.apiBase}/api/tasks/update`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, status, progress, error })
            });
            await handleJson(res);
            return true;
        } catch (e) {
            console.error("Failed to update task:", e);
            return false;
        }
    }
};

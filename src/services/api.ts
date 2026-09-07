import type { Candle, PlaceOrderInput, Symbol } from "./schemas.ts";

export const API_BASE = import.meta.env.VITE_API_URL || "";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) { super(message); this.name = "ApiError"; this.status = status; }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: { "Content-Type": "application/json", ...(init?.headers || {}) }, ...init });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.detail || json?.error || res.statusText, res.status);
  return json as T;
}

const now = () => new Date().toISOString();
const user = { id: "local-shioaji-user", email: "local@shioaji", firstName: "Local", lastName: "Simulation", roles: ["TRADER"], status: "ACTIVE", createdAt: now() };
const account = (id = "shioaji-simulation") => ({ id, userId: user.id, templateId: "SINOPAC-SIMULATION", label: "永豐模擬帳戶", status: "ACTIVE", balance: 1_000_000, equity: 1_000_000, margin: 0, freeMargin: 1_000_000, phase: "SIMULATION", startDate: now(), createdAt: now(), updatedAt: now(), isHftMode: false, template: { name: "Shioaji Simulation", startingBalance: 1_000_000, instrumentType: "FUTURES" as const } });

const remoteApi = {
  async demoLogin() { return { accessToken: "local-shioaji", refreshToken: "local-shioaji", user }; },
  async login() {
    await request<{ authenticated: boolean; simulation: boolean; accounts: unknown[] }>("/api/auth/login", { method: "POST" });
    return { accessToken: "sinopac-api-session", refreshToken: "sinopac-api-session", user: { ...user, email: "sinopac-api" } };
  },
  async logout() { return { success: true }; },
  async refreshToken() { return { accessToken: "local-shioaji", refreshToken: "local-shioaji" }; },
  async getMyProfile() { return user; },
  async getMe() { return user; },
  async getMyAccounts() { return [account()]; },
  async getAccount(id: string) { return account(id); },
  async getAccountMetrics(id: string) { const a = account(id); return { accountId: id, equity: a.equity, balance: a.balance, freeMargin: a.freeMargin, marginUsed: a.margin, floatingPnl: 0, dailyPnl: 0, status: a.status, phase: a.phase, highWaterMark: a.balance, startingBalance: a.balance, currency: "TWD", lastMarkTs: now() }; },
  async getAccountStats() { return { totalTrades: 0, winRate: 0, avgWin: 0, avgLoss: 0, profitFactor: 0, bestTrade: 0, worstTrade: 0 }; },
  async getEquityHistory() { return []; },
  async getLedger() { return { data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }; },
  async getSymbols(): Promise<Symbol[]> { return request("/api/symbols"); },
  async getCandles(symbol: string, timeframe: string, limit = 500): Promise<Candle[]> { return request(`/api/market/candles?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&limit=${limit}`); },
  async getCandlesWithMeta(symbol: string, timeframe: string, limit = 500) { const candles = await this.getCandles(symbol, timeframe, limit); return { candles, metadata: { isPartial: false } }; },
  async getTick(symbol: string) { const ticks = await request<any[]>(`/api/market/ticks?symbol=${encodeURIComponent(symbol)}&limit=1`); const t = ticks.at(-1); return { symbol, bid: t?.bid_price ?? t?.close ?? 0, ask: t?.ask_price ?? t?.close ?? 0, timestamp: t?.occurredAt ? Date.parse(t.occurredAt) : Date.now() }; },
  async getMarketDataHealth() { return request("/api/health"); },
  async isAiTraderEnabled() { return false; },
  async getEconomicCalendar() { return []; },
  async placeOrder(input: PlaceOrderInput) { return request("/api/orders", { method: "POST", body: JSON.stringify({ symbol: input.symbol, side: input.side, quantity: input.quantity, price: input.price }) }); },
  async getOrders() { return []; },
  async getPositions() { return []; },
  async getOpenPositionCount() { return 0; },
  async getFills() { return { data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }; },
  async getClosedPositions() { return { data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 }; },
  async getClosedPositionsSummary() { return { pnl: 0, commission: 0, swap: 0, tradeCount: 0 }; },
  async getFillQuality() { return { avgScore: null, count: 0, entries: [] }; },
  async cancelOrder() { return { success: true }; },
  async modifyOrder() { return null; },
  async cancelAllOrders() { return { success: true }; },
  async closePosition() { return { success: true }; },
  async closeAllPositions() { return { success: true }; },
  async modifyPosition() { return { success: true }; },
  async getJournalEntries() { return []; },
  async createJournalEntry() { return null; },
  async updateJournalEntry() { return null; },
  async deleteJournalEntry() { return { success: true }; },
  async getFeatureFlags() { return {}; },
  async getAnnouncements() { return []; },
  async getAnnouncementsUnreadCount() { return 0; },
  async replayGetSession() { return null; },
};

export const api: any = new Proxy(remoteApi as Record<string, unknown>, {
  get(target, prop: string) {
    if (prop in target) return target[prop];
    return (..._args: never[]) => Promise.resolve(null);
  },
});

export type ConnectionState = "connected" | "connecting" | "reconnecting" | "disconnected";
export type WsHandler = (event: unknown) => void;

class ShioajiSseClient {
  private _state: ConnectionState = "disconnected";
  private listeners = new Set<(s: ConnectionState) => void>();
  private handlers = new Map<string, Set<WsHandler>>();
  private source: EventSource | null = null;

  get state() { return this._state; }
  private setState(state: ConnectionState) { this._state = state; this.listeners.forEach((cb) => cb(state)); }
  connect(_token?: string) {
    if (this.source) return;
    this.setState("connecting");
    this.source = new EventSource("/api/market/stream");
    this.source.addEventListener("tick", (ev) => {
      const raw = JSON.parse((ev as MessageEvent).data);
      const close = Number(raw.close || 0);
      const bid = Number(raw.bid_price || close);
      const ask = Number(raw.ask_price || close);
      const occurredAt = typeof raw.occurredAt === "string" ? Date.parse(raw.occurredAt) : Date.now();
      this.emit("market-data", { eventType: "MarketTick", symbol: raw.symbol, bid, ask, occurredAt });
      this.emit("market-data", { eventType: "CandleUpdate", symbol: raw.symbol, timeframe: "1m", open: close, high: close, low: close, close, volume: Number(raw.volume || 0), timestamp: occurredAt });
    });
    this.source.onopen = () => this.setState("connected");
    this.source.onerror = () => { this.setState("reconnecting"); this.source?.close(); this.source = null; setTimeout(() => this.connect(), 3000); };
  }
  disconnect(_token?: string) { this.source?.close(); this.source = null; this.setState("disconnected"); }
  reauthenticate(_token: string) {}
  subscribe(channel: string, handler: WsHandler) { const set = this.handlers.get(channel) || new Set<WsHandler>(); set.add(handler); this.handlers.set(channel, set); return () => { set.delete(handler); }; }
  subscribeAccounts(_accountIds: string[]) {}
  setSymbolInterest() {}
  onStateChange(cb: (s: ConnectionState) => void) { this.listeners.add(cb); cb(this._state); return () => { this.listeners.delete(cb); }; }
  private emit(channel: string, event: unknown) { this.handlers.get(channel)?.forEach((handler) => handler(event)); }
}
export const wsClient = new ShioajiSseClient();

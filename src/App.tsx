import { useEffect, useState } from "react";
import { TradingPage } from "./pages/TradingPage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { useAuthStore, useTradingStore } from "./services/store.tsx";
import { API_BASE } from "./services/api.ts";

/**
 * OpenCharts entry point.
 *
 * No auth / routing: the app boots straight into the trading terminal backed by
 * the in-browser demo session (real bundled OHLC + paper-trading engine). A
 * demo "login" seeds the local user/account and starts the market-data feed.
 */
export function App() {
  const [ready, setReady] = useState(false);
  const accessToken = useAuthStore((s) => s.accessToken);
  const isDemo = useAuthStore((s) => s.isDemo);
  const restoreSession = useAuthStore((s) => s.restoreSession);
  const loadSymbols = useTradingStore((s) => s.loadSymbols);
  const loadAccounts = useTradingStore((s) => s.loadAccounts);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      await restoreSession();
      if (!useAuthStore.getState().accessToken) return;
      await Promise.all([loadSymbols(), loadAccounts()]);
      const code = localStorage.getItem("shioaji_symbol") || "TXFR1";
      fetch(`${API_BASE}/api/market/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, security_type: "FUT", quote_type: "tick" }),
      }).catch(() => undefined);
      if (!cancelled) setReady(true);
    }
    boot();
    return () => {
      cancelled = true;
    };
  }, [restoreSession, loadSymbols, loadAccounts, accessToken]);

  if (!accessToken || isDemo) return <LoginPage />;

  if (!ready) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[#0a0a0a] text-neutral-400">
        Loading OpenCharts…
      </div>
    );
  }

  return <TradingPage />;
}

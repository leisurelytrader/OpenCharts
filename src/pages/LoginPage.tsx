import { useState } from "react";
import { useAuthStore } from "../services/store.tsx";

export function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    setError(null);
    setLoading(true);
    try {
      await login();
    } catch (err) {
      setError(err instanceof Error ? err.message : "永豐 API 登入失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 text-neutral-100">
      <section className="w-full max-w-sm space-y-5 rounded-xl border border-neutral-800 bg-[#111] p-7 shadow-2xl">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-emerald-400">OpenCharts</p>
          <h1 className="mt-2 text-2xl font-semibold">永豐 API 登入</h1>
          <p className="mt-2 text-sm leading-6 text-neutral-400">
            API Key、Secret Key 與 CA 憑證只會由後端讀取。登入成功後即可查看永豐即時行情與 K 棒。
          </p>
        </div>
        {error && <p role="alert" className="rounded-md border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">{error}</p>}
        <button onClick={handleLogin} disabled={loading} className="w-full rounded-md bg-emerald-600 px-4 py-2 font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50" type="button">
          {loading ? "連線中…" : "連線永豐 API"}
        </button>
        <p className="text-xs text-neutral-500">目前只啟用行情與 K 棒；下單登入及下單功能尚未開放。</p>
      </section>
    </main>
  );
}

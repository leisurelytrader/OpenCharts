# OpenCharts + 永豐 Shioaji 即時看盤 MVP

本專案把 [OpenCharts](https://github.com/dylanpersonguy/OpenCharts) 的既有交易終端 UI 接到本機 FastAPI gateway，再由 gateway 以 [永豐 Shioaji](https://sinotrade.github.io/zh/) 接收期貨／選擇權即時行情。前端不接觸 API Key、Secret Key 或憑證；所有 tick 會先落入 SQLite，再透過 SSE 廣播至瀏覽器。

## 已完成範圍

- `Shioaji(simulation=True)` 安全預設；`SHIOAJI_SIMULATION=false` 不會被前端設定，避免 UI 誤切換正式模式。
- 依永豐文件使用 `api.contracts.get(code)` 取得商品檔；連續期貨會由 Shioaji 處理 `target_code`。
- 使用 `api.quote.subscribe(contract, quote_type="tick")` 與 `set_on_tick_fop_v1_callback` 接收期貨／選擇權 tick。
- SSE `/api/market/stream` 廣播即時資料。
- SQLite `backend/data/market_ticks.sqlite3` 保存每一筆 tick，且有 `symbol + ts` 索引；資料不提交 Git。
- `/api/market/candles` 以已保存 tick 聚合 1 分鐘 OHLCV。
- 基本模擬下單端點 `/api/orders`；正式模式時端點直接鎖定。

> 歷史 ticks 僅應用於盤後分析／回補，不以盤中輪詢取代即時訂閱，符合永豐歷史行情文件的限制。

## 安裝與啟動

需要 Python 3.10+、Node.js 20+。在專案根目錄執行：

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

編輯 `backend/.env`，填入你自己的永豐 API 金鑰：

```dotenv
SJ_API_KEY=你的_API_KEY
SJ_SEC_KEY=你的_SECRET_KEY
SHIOAJI_SIMULATION=true
TICK_DB_PATH=./backend/data/market_ticks.sqlite3
```

啟動 gateway：

```bash
set -a; . backend/.env; set +a
uvicorn backend.app:app --host 127.0.0.1 --port 8000
```

另開終端啟動 OpenCharts：

```bash
npm ci
npm run dev
```

開啟 `http://localhost:5173`。前端開機會嘗試訂閱 `TXFR1`；可用 `localStorage.setItem("shioaji_symbol", "你的商品代碼")` 指定其他期貨商品。

## API 檢查

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:8000/api/info
curl -X POST http://127.0.0.1:8000/api/market/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"code":"TXFR1","security_type":"FUT","quote_type":"tick"}'
```

`/api/market/stream` 是 SSE；`/api/market/ticks?symbol=TXFR1&limit=100` 可檢查已落盤資料。

## 安全與永豐規範

API 金鑰只放在 `backend/.env`，不得放入前端或 Git。正式模式下單具有真實財務風險，本專案預設不允許透過前端切換；正式環境需由操作者自行修改 gateway 的環境設定並重新審核所有下單程式。請先在永豐 simulation 環境測試帳號、商品權限、交易時段與斷線重連行為。

本專案不提供投資建議，也不保證行情延遲、網路中斷、交易所狀態或 Shioaji 版本升級下的行為。

## 驗證狀態

- Python backend syntax check：通過。
- SQLite initialization：通過。
- Vite production build：需執行 `npm run build` 驗證。
- `npm run typecheck`：OpenCharts 原始 UI 對 demo schema 有既有強耦合；遠端 facade 會產生部分 UI 型別錯誤，尚未宣稱通過。

## 參考文件

- [永豐快速入門](https://sinotrade.github.io/zh/quickstart/#_1)
- [登入與 simulation](https://sinotrade.github.io/zh/tutor/login/)、[模擬模式](https://sinotrade.github.io/zh/tutor/simulation/)
- [商品合約](https://sinotrade.github.io/zh/tutor/contract/)
- [期貨／選擇權即時行情](https://sinotrade.github.io/zh/tutor/market_data/streaming/futures/)
- [歷史行情](https://sinotrade.github.io/zh/tutor/market_data/historical/)
- [行情管理](https://sinotrade.github.io/zh/tutor/advanced/quote_manager_basic/)

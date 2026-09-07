# OpenCharts 程式碼審查報告

**審查對象：** `leisurelytrader/OpenCharts`  
**審查版本：** `c3475dc`（shallow clone，2026-09-07）  
**審查範圍：** 專案結構、前端 TypeScript/React、FastAPI gateway、API 整合、依賴、測試與建置。

## 總結

專案的 Vite production build 可以完成，現有 25 個單元測試也全部通過；然而目前不應視為可直接部署的穩定版本。`npm run typecheck` 失敗並回報 10 個 TypeScript 錯誤，主要集中於遠端 Shioaji facade 與既有 UI schema 之間的型別不一致。後端的 order endpoint 也缺乏業務輸入驗證，能接受非法交易方向；而 candles endpoint 忽略 `timeframe` 參數，所有請求都以 1 分鐘聚合。

此外，`npm audit` 回報 12 個漏洞（6 moderate、5 high、1 critical），其中 critical 漏洞位於開發依賴 Vitest。若只在本機使用，風險主要落在開發環境；若把測試/UI server 暴露到網路，風險會顯著升高。

**整體評估：** Demo/UI 展示層可運作，但 Shioaji gateway 與前端交易契約尚未達到 production-ready。建議先修正型別與 API 契約，再進行真實或模擬交易流程驗證；在此之前不要開啟正式交易模式。

## 驗證結果

| 檢查 | 結果 | 說明 |
| --- | --- | --- |
| `npm ci` | 通過 | 安裝 327 個套件；安裝後 npm audit 回報 12 個漏洞 |
| `npm run build` | 通過 | Vite production build 成功；最大未壓縮 chunk 約 684 kB |
| `npm run typecheck` | **失敗** | 10 個錯誤，涉及 `TradingPage.tsx`、`BottomPanel.tsx`、`queries.ts` |
| `npm test -- --reporter=verbose` | 通過 | 2 個 test files、25 個 tests 全部通過 |
| Python `compileall` | 通過 | `backend` 語法可編譯 |
| FastAPI smoke test | 部分通過 | health/info/symbols 正常；非法 order input 未被拒絕 |
| `npm audit` | **需處理** | 1 critical、5 high、6 moderate |

## 主要發現

### 1. [高] TypeScript 型別檢查失敗，CI 若加入 typecheck 將直接失敗

`npm run typecheck` 在以下區域產生 10 個錯誤：

- `src/pages/TradingPage.tsx:422`、`:588`：store 的 `symbols` 型別允許 `name` 為 optional，但 `ChartToolbar` 與 `WatchlistPanel` 要求 `name` 必填。
- `src/pages/TradingPage.tsx:574`：`setConfirmOrder` 的 state setter 與 `OrderPanel` 要求的 `ConfirmableOrder` callback 型別不相容。
- `src/pages/TradingPage.tsx:644`、`:667`、`:674`：`positions`、`modifyingPosition`、`modifyingOrder` 的 schema 推導欄位為 optional，但下游元件要求 `id` 等欄位必填。
- `src/pages/trading/BottomPanel.tsx:252`、`:261`：open positions/orders 同樣無法符合 table row 型別。
- `src/services/queries.ts:590`：mutation variables 被推導成 `unknown`，因此 `accountId` 不可使用。
- `src/services/queries.ts:777`：mutation result 被推導成 `unknown`，因此 `autoExecuted` 不可使用。

這不是單純 lint 問題：它表示資料層契約沒有被明確統一，後續若直接以 cast 壓掉錯誤，可能把缺少 `id`、symbol 或交易欄位的資料傳入 UI 操作元件。

**建議：** 以 `Symbol`、`Position`、`Order` 等 schema inference 作為單一來源，讓 API facade、Zustand store、query hooks 與元件 props 共用同一組 domain types；對 partial/WS payload 另建明確的 `PartialPosition`/`PartialOrder` 型別，並在進入 UI 前完成 runtime parse/normalize。

### 2. [高] Order API 沒有驗證 `side`、symbol 與交易語意

`backend/app.py:131-136` 的 `OrderRequest` 將 `side` 與 `symbol` 宣告為一般字串，`backend/app.py:232-236` 只檢查 `SHIOAJI_SIMULATION`，便直接回傳 `SIMULATION_ACCEPTED`。

實際 smoke test：

```text
POST /api/orders
{"symbol":"TXFR1","side":"INVALID","quantity":1,"price":0}

HTTP 200
{"status":"SIMULATION_ACCEPTED", "side":"INVALID", "price":0.0, ...}
```

這會讓錯誤或惡意 payload 被當成有效模擬訂單。更重要的是，該 endpoint 目前沒有建立 order、沒有持倉、沒有成交或風控狀態；它只是回傳 UUID。因此前端的「下單」與 README 所描述的 paper-trading engine 並不一致。

**建議：** 使用 `Literal["BUY", "SELL"]`、正數價格條件、已知 symbol/contract 檢查及 order type-specific validation；建立明確的 order lifecycle，或在文件與 UI 中將此 endpoint 明確標為 stub。正式模式前必須加入權限、帳戶、商品權限、數量/保證金與重複請求處理。

### 3. [高] candles endpoint 忽略 timeframe，請求 5m/1h 等週期仍回傳 1m

`backend/app.py:208-221` 接收 `timeframe` 參數，但實作固定使用：

```python
bucket = ts - (ts % 60)
```

因此 `1m`、`5m`、`1h` 等請求都以 60 秒 bucket 聚合。前端 `src/services/api.ts:35` 會傳入實際 timeframe，造成圖表週期與資料內容不一致，尤其會影響指標、K 線數量、交易判斷與使用者對行情的理解。

**建議：** 建立受限 timeframe 到秒數的 map，使用對應 bucket；對不支援的 timeframe 回傳 400，而不是靜默降級。補上 1m/5m/1h 的 endpoint 測試，確認 OHLCV 聚合順序與交易時區。

### 4. [高] 前端宣稱 backend-agnostic，但 Shioaji 整合仍是半接線狀態

`src/App.tsx:27-32` 啟動時會呼叫 `/api/market/subscribe`，`src/services/ws.ts:15` 建立 `/api/market/stream` 的 SSE；但 `src/services/api.ts:42-58` 的多個交易方法仍是空 stub：

- `getOrders()` 回傳空陣列
- `getPositions()` 回傳空陣列
- `getFills()`、`getClosedPositions()` 回傳空資料
- `cancelOrder()`、`closePosition()`、`modifyPosition()` 直接回傳成功
- journal methods 多數回傳 `null` 或空資料

因此 UI 可能顯示成功，但不會真的改變後端狀態。README 的 demo layer 描述與 `README_SHIOAJI.md` 的 gateway 描述也沒有清楚區分「demo paper engine」與「Shioaji gateway」。

**建議：** 將 backend adapter 分成清楚的 demo 與 Shioaji 實作，避免在同一個 `api` 物件裡以大量假成功值掩蓋未實作功能；對未支援操作明確回傳 501/feature-not-supported，並在 UI 顯示不可用狀態。

### 5. [中] SSE client 的錯誤處理可能造成重連競態與未捕捉 JSON 錯誤

`src/services/ws.ts:16-26` 直接 `JSON.parse` SSE data。若 gateway 傳送格式錯誤，事件 handler 會拋例外；而 `onerror` 會關閉來源並以固定 3 秒重連。`connect()` 沒有保存或清理重連 timer，也沒有 backoff/jitter，長時間 gateway 故障時會持續重試。

**建議：** 對 SSE payload 做 schema parse，忽略或記錄無效事件；保存 reconnect timer、在 disconnect 時取消 timer；採用 bounded exponential backoff，並讓多次 connect 不會建立重複 timer。

### 6. [中] 跨來源政策與 gateway 存取控制不足

`backend/app.py:31` 只限制了兩個 localhost origin，這對本機開發合理，但沒有 authentication/authorization、rate limiting、SSE connection limits 或 CSRF/部署層說明。若服務被反向代理公開，`/api/orders`、訂閱、資料查詢都沒有使用者或帳戶驗證。

**建議：** production gateway 必須放在可信網路或反向代理後，加入身份驗證、帳戶授權、origin/CSRF policy、請求速率限制與 audit log；限制 SSE 每個使用者的連線數，並對 SQLite 寫入做壓力測試。

### 7. [中] 依賴存在 12 個已知漏洞

`npm audit` 統計如下：

| 嚴重度 | 數量 |
| --- | ---: |
| Critical | 1 |
| High | 5 |
| Moderate | 6 |

重點包括 Vitest 的 critical advisory、React Router 的 high advisories、Vite/esbuild 相關 advisories，以及 browserslist、nanoid、postcss 等套件問題。部分修正需要升級到 Vitest 5 等 major version，不能只執行無風險的小版本修補。

**建議：** 先在隔離分支執行 `npm audit fix` 並重新跑 build/typecheck/test；再評估 Vitest 5 migration。不要讓 Vitest UI 或開發伺服器暴露於不可信網路。建立 lockfile 更新與依賴安全掃描的 CI gate。

### 8. [低] production bundle 偏大

Vite build 顯示主要 index chunk 約 684 kB（未壓縮），超過 500 kB 警告。交易終端包含圖表、繪圖工具與多個 UI library，這是可以理解的，但會增加首次載入時間。

**建議：** 以 route/component lazy loading、Rollup manual chunks、按需載入 drawing tools 和低頻使用面板改善；將 bundle size 變成 CI budget，而不是單純調高 warning threshold。

## 測試缺口

現有測試只有：

- `src/__tests__/button.test.tsx`：Button 元件 9 項
- `src/__tests__/utils.test.ts`：utility 16 項

目前沒有涵蓋：

1. FastAPI endpoint 與 Pydantic input validation。
2. candles timeframe 聚合。
3. order validation、simulation gate 與錯誤狀態。
4. SSE reconnect、無效 payload 與 disconnect cleanup。
5. demo/Shioaji API facade 的契約一致性。
6. paper trading engine 的下單、成交、SL/TP、P&L 與持倉生命週期。

## 建議修正順序

### P0：不可先開正式交易

1. 將 order request 改為嚴格 schema，拒絕非法 side、symbol、價格與交易數量。
2. 對正式模式加入 authentication、account authorization、audit log 與明確的 simulation gate。
3. 明確移除或標示假成功的 order/position methods，避免 UI 顯示虛假的交易結果。

### P1：恢復工程可靠性

1. 修正 10 個 TypeScript typecheck errors，不要以無差別 `any` 或 cast 掩蓋。
2. 實作 timeframe aggregation，補 backend endpoint tests。
3. 將 domain schema 統一於 API/store/components，並對 WS payload 做 runtime validation。
4. 修補 npm 依賴漏洞，特別是 critical/high advisory。

### P2：可維運性與效能

1. 加入 SSE bounded backoff、timer cleanup、連線上限與 metrics。
2. 增加 order engine、market data、gateway integration tests。
3. 對 production bundle 做 code splitting。
4. 更新 README，清楚說明 demo mode、Shioaji mode、未實作 endpoint 與部署安全要求。

## 結論

OpenCharts 目前適合作為 charting terminal prototype、UI demo 或 adapter 開發起點。前端 build 和基礎單元測試是正向訊號，但型別檢查失敗、交易 API 驗證不足、timeframe bug，以及大量交易方法仍為 stub，使其不適合直接連接正式帳戶或宣稱已完成的交易系統。完成 P0/P1 修正並增加端到端測試前，應維持 `SHIOAJI_SIMULATION=true`，且 gateway 不應公開到未受信任網路。

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import threading
import uuid
from collections import defaultdict
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

try:
    import shioaji as sj
except ImportError:  # Allows the UI/API contract to be tested before installing Shioaji.
    sj = None

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.getenv("TICK_DB_PATH", ROOT / "data" / "market_ticks.sqlite3"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)
SIMULATION = os.getenv("SHIOAJI_SIMULATION", "true").lower() == "true"

app = FastAPI(title="OpenCharts Shioaji Gateway", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])

_db_lock = threading.Lock()
_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
_subscribed: dict[str, dict[str, Any]] = {}
_shioaji: Any = None


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _db_lock, closing(db()) as conn:
        conn.execute("""CREATE TABLE IF NOT EXISTS ticks (
            id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, code TEXT NOT NULL,
            exchange TEXT NOT NULL, ts TEXT NOT NULL, close REAL, volume INTEGER,
            bid_price REAL, bid_volume INTEGER, ask_price REAL, ask_volume INTEGER,
            tick_type INTEGER, raw_json TEXT NOT NULL,
            UNIQUE(symbol, code, ts, close, volume)
        )""")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ticks_symbol_ts ON ticks(symbol, ts)")
        conn.commit()


def serialise(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if hasattr(value, "item"):
        return value.item()
    if isinstance(value, (list, tuple)):
        return [serialise(v) for v in value]
    if isinstance(value, dict):
        return {str(k): serialise(v) for k, v in value.items()}
    return value


def tick_dict(tick: Any, symbol: str, code: str, exchange: str) -> dict[str, Any]:
    raw = serialise(tick.to_dict() if hasattr(tick, "to_dict") else vars(tick))
    raw["symbol"] = symbol
    raw["code"] = code
    raw["exchange"] = exchange
    raw["occurredAt"] = raw.get("datetime") or raw.get("ts") or datetime.now(timezone.utc).isoformat()
    raw["close"] = float(raw.get("close") or 0)
    raw["bid_price"] = float(raw.get("bid_price") or 0)
    raw["ask_price"] = float(raw.get("ask_price") or 0)
    return raw


def persist_tick(item: dict[str, Any]) -> None:
    ts = str(item.get("occurredAt"))
    with _db_lock, closing(db()) as conn:
        conn.execute("""INSERT OR IGNORE INTO ticks
          (symbol, code, exchange, ts, close, volume, bid_price, bid_volume, ask_price, ask_volume, tick_type, raw_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""", (
            item["symbol"], item.get("code", item["symbol"]), item.get("exchange", "TAIFEX"), ts,
            item.get("close"), item.get("volume"), item.get("bid_price"), item.get("bid_volume"),
            item.get("ask_price"), item.get("ask_volume"), item.get("tick_type"), json.dumps(item, ensure_ascii=False),
        ))
        conn.commit()


def emit(item: dict[str, Any]) -> None:
    persist_tick(item)
    for queue in list(_subscribers):
        try:
            queue.put_nowait(item)
        except asyncio.QueueFull:
            pass


def ensure_shioaji() -> Any:
    global _shioaji
    if _shioaji is not None:
        return _shioaji
    if sj is None:
        raise RuntimeError("Shioaji is not installed. Run pip install -r backend/requirements.txt")
    key, secret = os.getenv("SJ_API_KEY"), os.getenv("SJ_SEC_KEY")
    if not key or not secret:
        raise RuntimeError("SJ_API_KEY and SJ_SEC_KEY are required in backend/.env")
    _shioaji = sj.Shioaji(simulation=SIMULATION)
    _shioaji.login(api_key=key, secret_key=secret, subscribe_trade=False)

    def on_fop_tick(exchange: Any, tick: Any) -> None:
        code = str(getattr(tick, "code", ""))
        symbol = next((s for s, v in _subscribed.items() if v.get("target_code") == code or v.get("code") == code), code)
        emit(tick_dict(tick, symbol, code, str(exchange)))

    _shioaji.quote.set_on_tick_fop_v1_callback(on_fop_tick)
    return _shioaji


class SubscribeRequest(BaseModel):
    code: str = Field(min_length=1, max_length=30)
    security_type: str = "FUT"
    quote_type: str = "tick"


class OrderRequest(BaseModel):
    symbol: str
    side: str
    quantity: int = Field(gt=0, le=100)
    price: float | None = None


@app.on_event("startup")
def startup() -> None:
    init_db()


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "simulation": SIMULATION, "shioaji_installed": sj is not None, "database": str(DB_PATH)}


@app.get("/api/info")
def info() -> dict[str, Any]:
    return {"simulation": SIMULATION, "provider": "Sinopac Shioaji", "tickPersistence": True}


@app.post("/api/market/subscribe")
def subscribe(req: SubscribeRequest) -> dict[str, Any]:
    try:
        api = ensure_shioaji()
        contract = api.contracts.get(req.code)
        if contract is None:
            raise HTTPException(404, f"Contract not found: {req.code}")
        target = getattr(contract, "target_code", None)
        _subscribed[req.code] = {"code": req.code, "target_code": target, "quote_type": req.quote_type}
        api.quote.subscribe(contract, quote_type=req.quote_type)
        return {"subscribed": True, "code": req.code, "target_code": target, "simulation": SIMULATION}
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@app.post("/api/market/unsubscribe")
def unsubscribe(req: SubscribeRequest) -> dict[str, Any]:
    try:
        api = ensure_shioaji()
        contract = api.contracts.get(req.code)
        if contract:
            api.quote.unsubscribe(contract, quote_type=req.quote_type)
        _subscribed.pop(req.code, None)
        return {"unsubscribed": True, "code": req.code}
    except Exception as exc:
        raise HTTPException(503, str(exc)) from exc


@app.get("/api/market/stream")
async def stream(symbol: str | None = None) -> StreamingResponse:
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=5000)
    _subscribers.add(queue)

    async def events():
        try:
            yield ": connected\n\n"
            while True:
                item = await queue.get()
                if symbol and item.get("symbol") != symbol:
                    continue
                yield f"event: tick\ndata: {json.dumps(item, ensure_ascii=False)}\n\n"
        finally:
            _subscribers.discard(queue)
    return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/market/ticks")
def ticks(symbol: str, limit: int = Query(500, ge=1, le=10000)) -> list[dict[str, Any]]:
    with _db_lock, closing(db()) as conn:
        rows = conn.execute("SELECT raw_json FROM ticks WHERE symbol=? ORDER BY id DESC LIMIT ?", (symbol, limit)).fetchall()
    return [json.loads(row[0]) for row in reversed(rows)]


@app.get("/api/market/candles")
def candles(symbol: str, timeframe: str = "1m", limit: int = Query(500, ge=1, le=5000)) -> list[dict[str, Any]]:
    with _db_lock, closing(db()) as conn:
        rows = conn.execute("SELECT ts, close, volume FROM ticks WHERE symbol=? ORDER BY id DESC LIMIT ?", (symbol, limit * 20)).fetchall()
    buckets: dict[int, dict[str, Any]] = {}
    for row in reversed(rows):
        try: ts = int(datetime.fromisoformat(row[0].replace("Z", "+00:00")).timestamp())
        except Exception: continue
        bucket = ts - (ts % 60)
        price = float(row[1] or 0)
        if not price: continue
        c = buckets.setdefault(bucket, {"time": bucket, "open": price, "high": price, "low": price, "close": price, "volume": 0})
        c["high"] = max(c["high"], price); c["low"] = min(c["low"], price); c["close"] = price; c["volume"] += int(row[2] or 0)
    return list(buckets.values())[-limit:]


@app.get("/api/symbols")
def symbols() -> list[dict[str, Any]]:
    with _db_lock, closing(db()) as conn:
        codes = [r[0] for r in conn.execute("SELECT DISTINCT symbol FROM ticks ORDER BY symbol").fetchall()]
    codes = codes or ["TXFR1"]
    return [{"id": c, "name": c, "displayName": c, "category": "FUTURES", "contractSize": 1, "tickSize": 1, "tickValue": 1, "marginPercent": 0.1, "maxLeverage": 10, "commission": 0, "swapLong": 0, "swapShort": 0, "tradingHoursStart": None, "tradingHoursEnd": None, "isActive": True} for c in codes]


@app.post("/api/orders")
def order(req: OrderRequest) -> dict[str, Any]:
    if not SIMULATION:
        raise HTTPException(403, "Order endpoint is locked unless SHIOAJI_SIMULATION=true")
    return {"id": str(uuid.uuid4()), "status": "SIMULATION_ACCEPTED", "symbol": req.symbol, "side": req.side, "quantity": req.quantity, "price": req.price}

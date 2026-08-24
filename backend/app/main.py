from __future__ import annotations

import asyncio
import json
import logging
import math
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Literal

from fastapi import (
    FastAPI,
    HTTPException,
    Query,
    Request,
    Response,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .alpha_vantage import (
    ALPHA_ASSET_BY_SYMBOL,
    ALPHA_ASSETS,
    AlphaAssetClass,
    AlphaSeriesResult,
    AlphaVantageClient,
    AlphaVantageError,
    AlphaVantageRateLimitError,
)
from .alerts import AlertEngine
from .config import Settings
from .domain import AlertRule, Timeframe, primitive
from .historical import HistoricalDataError, parse_historical_data
from .ingestion import COMPONENTS, MarketEngine
from .schemas import AlertEvaluationRequest, AlertRuleCreate
from .store import InMemoryMarketStore, create_store
from .twelve_data import (
    TWELVE_SYMBOLS,
    TwelveDataClient,
    TwelveDataError,
    TwelveDataRateLimitError,
)
from .zones import completed_candles, detect_zones

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

VALID_SYMBOLS = {component.symbol for component in COMPONENTS} | {"GMI"}
MAX_HISTORICAL_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_HISTORICAL_IMPORT_ROWS = 10_000


def _store(request: Request) -> InMemoryMarketStore:
    return request.app.state.store


def _alert_engine(request: Request) -> AlertEngine:
    return request.app.state.alert_engine


def _known_symbols(request: Request) -> set[str]:
    imported = getattr(request.app.state, "historical_assets", {})
    return VALID_SYMBOLS | set(ALPHA_ASSET_BY_SYMBOL) | set(imported)


async def _market_history(
    request: Request,
    symbol: str,
    timeframe: Timeframe,
    limit: int,
) -> tuple[list, Timeframe, dict | None]:
    """Resolve uploaded, Twelve Data, Alpha Vantage, then local history."""

    imported = getattr(request.app.state, "historical_assets", {})
    alpha: AlphaVantageClient = request.app.state.alpha_vantage
    twelve: TwelveDataClient = request.app.state.twelve_data
    if symbol not in imported and (symbol == "GMI" or symbol in TWELVE_SYMBOLS) and twelve.configured:
        try:
            result = await twelve.get_candles(symbol, timeframe, limit)
            return list(result.candles)[-limit:], result.effective_timeframe, result.metadata()
        except TwelveDataRateLimitError as exc:
            logger.warning("Twelve Data rate limit; trying fallback: %s", exc)
        except TwelveDataError as exc:
            logger.warning("Twelve Data unavailable for %s; trying fallback: %s", symbol, exc)

    alpha_symbol = symbol == "GMI" or symbol in ALPHA_ASSET_BY_SYMBOL
    if symbol not in imported and alpha_symbol and alpha.configured:
        try:
            result: AlphaSeriesResult = await alpha.get_candles(symbol, timeframe)
            return list(result.candles)[-limit:], result.effective_timeframe, result.metadata()
        except AlphaVantageRateLimitError as exc:
            raise HTTPException(status_code=429, detail=str(exc)) from exc
        except AlphaVantageError as exc:
            fallback = await _store(request).get_candles(symbol, timeframe, limit)
            if fallback:
                return fallback, timeframe, {
                    "provider": "simulator_fallback",
                    "fallback_reason": str(exc),
                    "requested_timeframe": timeframe.value,
                    "effective_timeframe": timeframe.value,
                }
            raise HTTPException(status_code=502, detail=str(exc)) from exc

    history = await _store(request).get_candles(symbol, timeframe, limit)
    if not history and alpha_symbol and not alpha.configured:
        raise HTTPException(
            status_code=503,
            detail="Alpha Vantage is not configured; set GMI_ALPHA_VANTAGE_API_KEY.",
        )
    source = "historical_import" if symbol in imported else "simulator"
    return history, timeframe, {
        "provider": source,
        "requested_timeframe": timeframe.value,
        "effective_timeframe": timeframe.value,
    }


def _live_pressure(items: list[dict]) -> list[dict]:
    values = []
    for item in items:
        change = item.get("change_percent")
        if not isinstance(change, (int, float)):
            continue
        score = max(-100.0, min(100.0, float(change) * 20.0))
        values.append(
            {
                "key": f"twelve-{item.get('symbol', 'asset')}",
                "label": item.get("name") or item.get("symbol"),
                "group": item.get("asset_class") or "market",
                "score": round(score, 4),
                "state": "demand" if score > 10 else "supply" if score < -10 else "balanced",
                "confidence": 60.0,
                "drivers": {"price_change_pct": round(float(change), 4)},
            }
        )
    return values


async def _live_snapshot(request: Request) -> dict:
    twelve: TwelveDataClient = request.app.state.twelve_data
    if not twelve.configured:
        raise HTTPException(
            status_code=503,
            detail="Twelve Data is not configured; set GMI_TWELVE_DATA_API_KEY.",
        )
    try:
        try:
            result = await twelve.get_candles("GMI", Timeframe.M15, 200)
        except TwelveDataError:
            result = await twelve.get_candles("GMI", Timeframe.D1, 200)
        board = await twelve.get_board(limit=8)
    except TwelveDataRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except TwelveDataError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    candles = list(result.candles)
    latest = candles[-1]
    previous = candles[-2] if len(candles) > 1 else None
    change = ((latest.close / previous.close) - 1) * 100 if previous else 0.0
    zones = tuple(
        detect_zones(completed_candles(candles, as_of=datetime.now(timezone.utc)))[:SNAPSHOT_ZONE_LIMIT]
    )
    return {
        "sequence": int(latest.timestamp.timestamp()),
        "generated_at": latest.timestamp,
        "prices": {"GMI": latest.close},
        "changes_pct": {"GMI": round(change, 4)},
        "composite": {result.effective_timeframe.value: latest},
        "pressure": _live_pressure(board),
        "zones": {"GMI": zones},
        "alerts": [],
        "zones_by_timeframe": {result.effective_timeframe.value: {"GMI": zones}},
        "source": "twelve_data",
    }


def create_app(
    settings: Settings | None = None,
    *,
    alpha_vantage: AlphaVantageClient | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = await create_store(settings)
        alerts = AlertEngine()
        engine = MarketEngine(store, settings, alerts)
        alpha = alpha_vantage or AlphaVantageClient(settings)
        twelve = TwelveDataClient(settings)
        app.state.store = store
        app.state.alert_engine = alerts
        app.state.market_engine = engine
        app.state.alpha_vantage = alpha
        app.state.twelve_data = twelve
        app.state.historical_assets = {}
        ingestion_task = None
        if not twelve.configured:
            await engine.initialize(periods=min(120, max(20, settings.history_limit - 1)))
            ingestion_task = asyncio.create_task(engine.run(), name="market-ingestion")
        try:
            yield
        finally:
            if ingestion_task is not None:
                await engine.stop()
                try:
                    await ingestion_task
                except asyncio.CancelledError:
                    pass
            await alpha.close()
            await twelve.close()
            await store.close()

    app = FastAPI(
        title=settings.app_name,
        version=__version__,
        description=(
            "Real-time normalized global index, supply/demand pressure, "
            "structural zones, and proximity alerts."
        ),
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
    )

    @app.get("/", tags=["system"])
    async def root() -> dict:
        return {
            "service": settings.app_name,
            "version": __version__,
            "docs": "/docs",
            "websocket": "/ws/market",
        }

    @app.get("/health", tags=["system"])
    async def health(request: Request) -> dict:
        if request.app.state.twelve_data.configured:
            return {
                "status": "ok",
                "version": __version__,
                "provider": "twelve_data",
                "server_time": datetime.now(timezone.utc),
            }
        snapshot = await _store(request).latest_snapshot()
        return {
            "status": "ok" if snapshot else "starting",
            "version": __version__,
            "sequence": snapshot.sequence if snapshot else 0,
            "server_time": datetime.now(timezone.utc),
        }

    @app.get(f"{settings.api_prefix}/assets", tags=["markets"])
    async def assets(request: Request) -> dict:
        provider_name = "twelve_data" if request.app.state.twelve_data.configured else "alpha_vantage"
        alpha_catalog = [
            {
                "symbol": "GMI",
                "name": "Global Market Index",
                "asset_class": "index",
                "provider": "alpha_vantage",
                "provider_symbol": "SPX+NDX",
                "currency": "normalized",
                "price_basis": "50/50 normalized SPX and NDX",
                "supported_timeframes": [item.value for item in Timeframe],
            },
            *[asset.public_contract() for asset in ALPHA_ASSETS],
        ]
        for item in alpha_catalog:
            item["provider"] = provider_name
            if item["symbol"] in TWELVE_SYMBOLS:
                item["provider_symbol"] = TWELVE_SYMBOLS[item["symbol"]]
        return {
            "index": {
                "symbol": "GMI",
                "name": "Global Market Index",
                "base_value": 1_000.0,
                "methodology": "fixed-reference normalized weighted return index",
            },
            "components": primitive(COMPONENTS),
            "provider": {
                "name": provider_name,
                "configured": request.app.state.twelve_data.configured or request.app.state.alpha_vantage.configured,
                "intraday_enabled": settings.alpha_vantage_intraday_enabled,
                "daily_fallback": True,
            },
            "asset_catalog": alpha_catalog,
            "live_assets": alpha_catalog if (request.app.state.twelve_data.configured or request.app.state.alpha_vantage.configured) else [],
            "imported_assets": primitive(
                sorted(
                    getattr(request.app.state, "historical_assets", {}).values(),
                    key=lambda item: item["symbol"],
                )
            ),
            "timeframes": [timeframe.value for timeframe in Timeframe],
        }

    @app.get(f"{settings.api_prefix}/historical/assets", tags=["historical-data"])
    async def historical_assets(request: Request) -> dict:
        values = sorted(
            getattr(request.app.state, "historical_assets", {}).values(),
            key=lambda item: item["symbol"],
        )
        return {"count": len(values), "assets": primitive(values)}

    @app.post(f"{settings.api_prefix}/historical/import", tags=["historical-data"])
    async def import_historical_data(
        request: Request,
        symbol: str = Query(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._:/-]+$"),
        timeframe: Timeframe = Query(default=Timeframe.D1),
        mode: Literal["replace", "merge"] = Query(default="replace"),
        format: Literal["auto", "csv", "json"] = Query(default="auto"),
        name: str | None = Query(default=None, max_length=120),
        asset_class: str = Query(default="custom", max_length=48),
        currency: str | None = Query(default=None, max_length=12),
    ) -> dict:
        """Upload UTF-8 CSV or JSON OHLCV data for any symbol.

        Required columns are timestamp, open, high, low, and close. Volume is
        optional. `replace` swaps the timeframe history; `merge` retains bars
        not present in the upload and lets uploaded duplicate timestamps win.
        """

        body = await request.body()
        if len(body) > MAX_HISTORICAL_UPLOAD_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"upload exceeds the {MAX_HISTORICAL_UPLOAD_BYTES // (1024 * 1024)} MB limit",
            )
        normalized_symbol = symbol.upper()
        try:
            parsed = parse_historical_data(
                body,
                symbol=normalized_symbol,
                timeframe=timeframe,
                source_format=format,
                max_rows=MAX_HISTORICAL_IMPORT_ROWS,
            )
        except HistoricalDataError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        retained = await _store(request).replace_candles(
            normalized_symbol,
            timeframe,
            list(parsed.candles),
            merge=mode == "merge",
        )
        registry = request.app.state.historical_assets
        existing = registry.get(normalized_symbol, {})
        timeframes = set(existing.get("timeframes", []))
        timeframes.add(timeframe.value)
        latest = retained[-1]
        asset = {
            "symbol": normalized_symbol,
            "name": name.strip() if name and name.strip() else existing.get("name", normalized_symbol),
            "asset_class": asset_class.strip() or "custom",
            "currency": currency.strip().upper() if currency and currency.strip() else existing.get("currency"),
            "timeframes": sorted(timeframes, key=lambda item: Timeframe(item).seconds),
            "last_imported_at": datetime.now(timezone.utc),
            "latest_close": latest.close,
            "latest_timestamp": latest.timestamp,
        }
        registry[normalized_symbol] = asset
        return primitive(
            {
                "asset": asset,
                "timeframe": timeframe,
                "mode": mode,
                "format": parsed.source_format,
                "rows_received": parsed.rows_received,
                "rows_deduplicated": parsed.rows_deduplicated,
                "rows_retained": len(retained),
                "history_limit": _store(request).history_limit,
                "latest_candle": latest,
            }
        )

    @app.get(f"{settings.api_prefix}/snapshot", tags=["markets"])
    async def snapshot(request: Request) -> dict:
        if request.app.state.twelve_data.configured:
            return await _live_snapshot(request)
        latest = await _store(request).latest_snapshot()
        if latest is None:
            raise HTTPException(status_code=503, detail="market engine is starting")
        return primitive(latest)

    @app.get(f"{settings.api_prefix}/index/candles", tags=["markets"])
    async def candles(
        request: Request,
        symbol: str = Query(default="GMI"),
        timeframe: Timeframe = Query(default=Timeframe.M15),
        limit: int = Query(default=120, ge=1, le=500),
    ) -> dict:
        normalized_symbol = symbol.upper()
        if normalized_symbol not in _known_symbols(request):
            raise HTTPException(
                status_code=404,
                detail=f"unknown symbol; choose one of {sorted(VALID_SYMBOLS)}",
            )
        values, effective_timeframe, provider = await _market_history(
            request, normalized_symbol, timeframe, limit
        )
        return {
            "symbol": normalized_symbol,
            "requested_timeframe": timeframe.value,
            "timeframe": effective_timeframe.value,
            "count": len(values),
            "candles": primitive(values),
            "source": provider,
        }

    @app.get(f"{settings.api_prefix}/pressure", tags=["supply-demand"])
    async def pressure(request: Request, group: str | None = None) -> dict:
        latest = await _store(request).latest_snapshot()
        if latest is None:
            raise HTTPException(status_code=503, detail="market engine is starting")
        values = latest.pressure
        if group:
            values = tuple(
                item for item in values if item.group.casefold() == group.casefold()
            )
        return {
            "scale": {"minimum": -100, "maximum": 100, "positive": "demand"},
            "generated_at": primitive(latest.generated_at),
            "items": primitive(values),
        }

    @app.get(f"{settings.api_prefix}/alpha/board", tags=["markets"])
    async def alpha_board(
        request: Request,
        asset_class: str | None = Query(default=None),
        limit: int = Query(default=8, ge=1, le=8),
    ) -> dict:
        """Return cached provider quotes for boards and heatmaps."""
        alpha: AlphaVantageClient = request.app.state.alpha_vantage
        twelve: TwelveDataClient = request.app.state.twelve_data
        if twelve.configured:
            try:
                items = await twelve.get_board(asset_class, limit)
            except TwelveDataRateLimitError as exc:
                raise HTTPException(status_code=429, detail=str(exc)) from exc
            except TwelveDataError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            return {
                "count": len(items),
                "items": primitive(items),
                "provider": "twelve_data",
            }
        if not alpha.configured:
            raise HTTPException(
                status_code=503,
                detail="No market data provider is configured; set GMI_TWELVE_DATA_API_KEY or GMI_ALPHA_VANTAGE_API_KEY.",
            )
        normalized_class: AlphaAssetClass | None = None
        if asset_class:
            try:
                normalized_class = AlphaAssetClass(asset_class.casefold())
            except ValueError as exc:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported asset_class; choose one of {[item.value for item in AlphaAssetClass]}",
                ) from exc
        try:
            items = await alpha.get_board(normalized_class, limit)
        except AlphaVantageRateLimitError as exc:
            raise HTTPException(status_code=429, detail=str(exc)) from exc
        except AlphaVantageError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {
            "count": len(items),
            "items": primitive(items),
            "remaining_requests": alpha.daily_requests_remaining,
        }

    @app.get(f"{settings.api_prefix}/zones/{{symbol}}", tags=["supply-demand"])
    async def zones(
        symbol: str,
        request: Request,
        timeframe: Timeframe = Query(default=Timeframe.M15),
        include_tested: bool = Query(default=True),
        min_quality: float = Query(default=0, ge=0, le=100),
        limit: int = Query(default=20, ge=1, le=100),
    ) -> dict:
        normalized_symbol = symbol.upper()
        if normalized_symbol not in _known_symbols(request):
            raise HTTPException(status_code=404, detail="unknown symbol")
        history, effective_timeframe, provider = await _market_history(
            request, normalized_symbol, timeframe, settings.history_limit
        )
        detected = detect_zones(
            completed_candles(history, as_of=datetime.now(timezone.utc)),
            include_tested=include_tested,
        )
        filtered = [zone for zone in detected if zone.quality_score >= min_quality][
            :limit
        ]
        return {
            "symbol": normalized_symbol,
            "requested_timeframe": timeframe.value,
            "timeframe": effective_timeframe.value,
            "count": len(filtered),
            "zones": primitive(filtered),
            "source": provider,
        }

    @app.get(f"{settings.api_prefix}/alerts", tags=["alerts"])
    async def list_alerts(request: Request) -> dict:
        values = _alert_engine(request).list_rules()
        return {"count": len(values), "rules": primitive(values)}

    @app.post(
        f"{settings.api_prefix}/alerts",
        tags=["alerts"],
        status_code=status.HTTP_201_CREATED,
    )
    async def create_alert(payload: AlertRuleCreate, request: Request) -> dict:
        symbol = payload.symbol.upper()
        if symbol not in _known_symbols(request):
            raise HTTPException(status_code=404, detail="unknown symbol")
        rule = AlertRule(
            id=str(uuid.uuid4()),
            symbol=symbol,
            zone_side=payload.zone_side,
            mode=payload.mode,
            timeframe=payload.timeframe,
            threshold_pct=payload.threshold_pct,
            zone_id=payload.zone_id,
            enabled=payload.enabled,
            cooldown_seconds=payload.cooldown_seconds,
        )
        _alert_engine(request).add_rule(rule)
        return primitive(rule)

    @app.delete(
        f"{settings.api_prefix}/alerts/{{rule_id}}",
        tags=["alerts"],
        status_code=status.HTTP_204_NO_CONTENT,
    )
    async def delete_alert(rule_id: str, request: Request) -> Response:
        if not _alert_engine(request).remove_rule(rule_id):
            raise HTTPException(status_code=404, detail="alert rule not found")
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post(f"{settings.api_prefix}/alerts/evaluate", tags=["alerts"])
    async def evaluate_alerts(
        payload: AlertEvaluationRequest, request: Request
    ) -> dict:
        symbol = payload.symbol.upper()
        if symbol not in _known_symbols(request):
            raise HTTPException(status_code=404, detail="unknown symbol")
        history, _, _ = await _market_history(
            request, symbol, payload.timeframe, settings.history_limit
        )
        active_zones = detect_zones(
            completed_candles(history, as_of=datetime.now(timezone.utc))
        )
        events = _alert_engine(request).evaluate(
            symbol=symbol,
            previous_price=payload.previous_price,
            current_price=payload.current_price,
            zones=active_zones,
        )
        return {"count": len(events), "events": primitive(events)}

    @app.websocket("/ws/market")
    async def market_websocket(websocket: WebSocket) -> None:
        await websocket.accept()
        if websocket.app.state.twelve_data.configured:
            twelve: TwelveDataClient = websocket.app.state.twelve_data
            reverse_symbols = {value: key for key, value in TWELVE_SYMBOLS.items()}
            try:
                upstream = await twelve.open_quote_stream()
                try:
                    async for raw in upstream:
                        if isinstance(raw, bytes):
                            raw = raw.decode("utf-8", errors="ignore")
                        try:
                            event = json.loads(raw)
                        except (TypeError, json.JSONDecodeError):
                            continue
                        if not isinstance(event, dict):
                            continue
                        provider_symbol = str(event.get("symbol", "")).upper()
                        symbol = reverse_symbols.get(provider_symbol)
                        price = event.get("price", event.get("close"))
                        try:
                            price = float(price)
                        except (TypeError, ValueError):
                            continue
                        if not symbol or not math.isfinite(price) or price <= 0:
                            continue
                        timestamp = event.get("timestamp")
                        try:
                            generated_at = datetime.fromtimestamp(float(timestamp), tz=timezone.utc)
                        except (TypeError, ValueError, OSError):
                            generated_at = datetime.now(timezone.utc)
                        payload = {
                            "sequence": int(generated_at.timestamp() * 1000),
                            "generated_at": generated_at,
                            "prices": {symbol: price},
                            "changes_pct": {},
                            "composite": {},
                            "pressure": [],
                            "zones": {},
                            "alerts": [],
                            "zones_by_timeframe": {},
                            "source": "twelve_data_websocket",
                        }
                        await websocket.send_json({"type": "market.snapshot", "data": payload})
                finally:
                    await upstream.close()
            except (WebSocketDisconnect, RuntimeError, HTTPException, TwelveDataError):
                logger.info("live market websocket disconnected")
            return
        store: InMemoryMarketStore = websocket.app.state.store
        queue = await store.subscribe()
        try:
            latest = await store.latest_snapshot()
            if latest is not None:
                await websocket.send_json(
                    {"type": "market.snapshot", "data": primitive(latest)}
                )
            while True:
                update = await queue.get()
                await websocket.send_json(
                    {"type": "market.snapshot", "data": primitive(update)}
                )
        except (WebSocketDisconnect, RuntimeError):
            logger.info("market websocket disconnected")
        finally:
            await store.unsubscribe(queue)

    return app


app = create_app()

from __future__ import annotations

import asyncio
import logging
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
from .alerts import AlertEngine
from .config import Settings
from .domain import AlertRule, Timeframe, primitive
from .historical import HistoricalDataError, parse_historical_data
from .ingestion import COMPONENTS, MarketEngine
from .massive import (
    MASSIVE_ASSET_BY_SYMBOL,
    MASSIVE_ASSETS,
    MASSIVE_PUBLIC_SYMBOLS,
    MassiveClient,
    MassiveEntitlementError,
    MassiveError,
    MassiveRateLimitError,
    MassiveSeriesResult,
    canonical_symbol,
)
from .schemas import AlertEvaluationRequest, AlertRuleCreate
from .store import InMemoryMarketStore, create_store
from .zones import completed_candles, detect_zones

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
# httpx logs full query strings at INFO, which would expose Massive's query-key
# authentication in local or hosted runtime logs.
logging.getLogger("httpx").setLevel(logging.WARNING)

VALID_SYMBOLS = (
    {component.symbol for component in COMPONENTS}
    | set(MASSIVE_PUBLIC_SYMBOLS)
    | {"GMI"}
)
MAX_HISTORICAL_UPLOAD_BYTES = 10 * 1024 * 1024
MAX_HISTORICAL_IMPORT_ROWS = 10_000
SNAPSHOT_ZONE_LIMIT = 12


def _store(request: Request) -> InMemoryMarketStore:
    return request.app.state.store


def _alert_engine(request: Request) -> AlertEngine:
    return request.app.state.alert_engine


def _known_symbols(request: Request) -> set[str]:
    imported = getattr(request.app.state, "historical_assets", {})
    return (
        VALID_SYMBOLS
        | set(imported)
    )


def _allow_simulator(request: Request) -> bool:
    settings: Settings = request.app.state.settings
    return settings.environment.casefold() != "production"


async def _market_history(
    request: Request,
    symbol: str,
    timeframe: Timeframe,
    limit: int,
) -> tuple[list, Timeframe, dict | None]:
    """Resolve uploaded history, Massive futures data, then local simulation."""

    symbol = canonical_symbol(symbol)

    imported = getattr(request.app.state, "historical_assets", {})
    massive: MassiveClient = request.app.state.massive
    massive_symbol = symbol == "GMI" or symbol in MASSIVE_ASSET_BY_SYMBOL
    if symbol not in imported and massive_symbol and massive.configured:
        try:
            result: MassiveSeriesResult = await massive.get_candles(
                symbol, timeframe, limit
            )
            return list(result.candles)[-limit:], result.effective_timeframe, result.metadata()
        except MassiveRateLimitError as exc:
            if not _allow_simulator(request):
                raise HTTPException(status_code=429, detail=str(exc)) from exc
            logger.warning("Massive rate limit; trying simulator fallback: %s", exc)
        except (MassiveEntitlementError, MassiveError) as exc:
            if not _allow_simulator(request):
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            logger.warning("Massive unavailable for %s; trying simulator: %s", symbol, exc)

    history = await _store(request).get_candles(symbol, timeframe, limit)
    if not _allow_simulator(request):
        raise HTTPException(
            status_code=503,
            detail="Massive is not configured or returned no data; set GMI_MASSIVE_API_KEY.",
        )
    if not history and massive_symbol and not massive.configured:
        raise HTTPException(
            status_code=503,
            detail="Massive is not configured; set GMI_MASSIVE_API_KEY.",
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
                "key": f"massive-{item.get('symbol', 'asset')}",
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
    massive: MassiveClient = request.app.state.massive
    if not massive.configured:
        raise HTTPException(
            status_code=503,
            detail="Massive is not configured; set GMI_MASSIVE_API_KEY.",
        )
    try:
        try:
            result = await massive.get_candles("GMI", Timeframe.M15, 200)
        except MassiveError:
            result = await massive.get_candles("GMI", Timeframe.D1, 200)
        # Boards have a dedicated cached endpoint. Keeping snapshots scoped to
        # GMI prevents a low-rate key from delaying the selected chart behind
        # a multi-asset quote warm-up.
        board: list[dict] = []
    except MassiveRateLimitError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    except MassiveError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    candles = list(result.candles)
    latest = candles[-1]
    previous = candles[-2] if len(candles) > 1 else None
    change = ((latest.close / previous.close) - 1) * 100 if previous else 0.0
    zones = tuple(
        detect_zones(completed_candles(candles, as_of=datetime.now(timezone.utc)))[:SNAPSHOT_ZONE_LIMIT]
    )
    prices = {item["symbol"]: item["price"] for item in board if item.get("price") is not None}
    changes = {
        item["symbol"]: item["change_percent"]
        for item in board
        if item.get("change_percent") is not None
    }
    prices["GMI"] = latest.close
    changes["GMI"] = round(change, 4)
    alert_events = []
    for rule in _alert_engine(request).list_rules():
        try:
            rule_result = await massive.get_candles(rule.symbol, rule.timeframe, 500)
            rule_candles = list(rule_result.candles)
            if not rule_candles:
                continue
            rule_zones = detect_zones(
                completed_candles(rule_candles, as_of=datetime.now(timezone.utc))
            )
            alert_events.extend(
                _alert_engine(request).evaluate(
                    symbol=rule.symbol,
                    previous_price=rule_candles[-2].close if len(rule_candles) > 1 else None,
                    current_price=rule_candles[-1].close,
                    zones=rule_zones,
                )
            )
        except MassiveError:
            logger.warning("Unable to evaluate live alert for %s", rule.symbol)
    return {
        "sequence": int(latest.timestamp.timestamp()),
        "generated_at": latest.timestamp,
        "prices": prices,
        "changes_pct": changes,
        "composite": {result.effective_timeframe.value: latest},
        "pressure": _live_pressure(board),
        "zones": {"GMI": zones},
        "alerts": alert_events,
        "zones_by_timeframe": {result.effective_timeframe.value: {"GMI": zones}},
        "source": "massive",
    }


def create_app(
    settings: Settings | None = None,
    *,
    massive_client: MassiveClient | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = await create_store(settings)
        alerts = AlertEngine()
        engine = MarketEngine(store, settings, alerts)
        massive = massive_client or MassiveClient(settings)
        app.state.store = store
        app.state.settings = settings
        app.state.alert_engine = alerts
        app.state.market_engine = engine
        app.state.massive = massive
        app.state.historical_assets = {}
        ingestion_task = None
        if not massive.configured and settings.environment.casefold() != "production":
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
            await massive.close()
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
        if request.app.state.massive.configured:
            return {
                "status": "ok",
                "version": __version__,
                "provider": "massive",
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
        configured = request.app.state.massive.configured
        asset_catalog = [
            {
                "symbol": "GMI",
                "name": "Global Market Index",
                "asset_class": "index",
                "provider": "massive",
                "provider_symbol": "ES+NQ",
                "currency": "normalized",
                "price_basis": "50/50 normalized ES and NQ front-month futures returns",
                "supported_timeframes": [item.value for item in Timeframe],
            },
            *(asset.public_contract() for asset in MASSIVE_ASSETS),
        ]
        return {
            "index": {
                "symbol": "GMI",
                "name": "Global Market Index",
                "base_value": 1_000.0,
                "methodology": "fixed-reference normalized weighted return index",
            },
            "components": primitive(COMPONENTS),
            "provider": {
                "name": "massive",
                "configured": configured,
                "intraday_enabled": True,
                "daily_fallback": False,
            },
            "asset_catalog": asset_catalog,
            "live_assets": asset_catalog if configured else [],
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
        symbol: str = Query(min_length=1, max_length=32, pattern=r"^[A-Za-z0-9._:/!\-]+$"),
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
        normalized_symbol = canonical_symbol(symbol)
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
        if request.app.state.massive.configured:
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
        normalized_symbol = canonical_symbol(symbol)
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
        if request.app.state.massive.configured:
            try:
                values = _live_pressure(
                    await request.app.state.massive.get_board(limit=5)
                )
            except MassiveRateLimitError as exc:
                raise HTTPException(status_code=429, detail=str(exc)) from exc
            except MassiveError as exc:
                raise HTTPException(status_code=502, detail=str(exc)) from exc
            if group:
                values = [item for item in values if item["group"].casefold() == group.casefold()]
            return {
                "scale": {"minimum": -100, "maximum": 100, "positive": "demand"},
                "generated_at": datetime.now(timezone.utc),
                "items": values,
                "provider": "massive",
            }
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

    @app.get(f"{settings.api_prefix}/market/board", tags=["markets"])
    @app.get(f"{settings.api_prefix}/massive/board", tags=["markets"])
    @app.get(f"{settings.api_prefix}/alpha/board", tags=["markets"])
    async def market_board(
        request: Request,
        asset_class: str | None = Query(default=None),
        limit: int = Query(default=5, ge=1, le=14),
    ) -> dict:
        """Return cached provider quotes for boards and heatmaps."""
        massive: MassiveClient = request.app.state.massive
        if not massive.configured:
            raise HTTPException(
                status_code=503,
                detail="Massive is not configured; set GMI_MASSIVE_API_KEY.",
            )
        normalized_class = asset_class.casefold() if asset_class else None
        if normalized_class not in {None, "index", "commodity"}:
            raise HTTPException(
                status_code=400,
                detail="Unsupported asset_class; choose one of ['index', 'commodity']",
            )
        try:
            items = await massive.get_board(normalized_class, limit)
        except MassiveRateLimitError as exc:
            raise HTTPException(status_code=429, detail=str(exc)) from exc
        except MassiveError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc
        return {
            "count": len(items),
            "items": primitive(items),
            "provider": "massive",
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
        normalized_symbol = canonical_symbol(symbol)
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
        symbol = canonical_symbol(payload.symbol)
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
        symbol = canonical_symbol(payload.symbol)
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
        if websocket.app.state.massive.configured:
            try:
                while True:
                    payload = await _live_snapshot(websocket)
                    await websocket.send_json(
                        {"type": "market.snapshot", "data": primitive(payload)}
                    )
                    await asyncio.sleep(settings.massive_poll_interval_seconds)
            except (WebSocketDisconnect, RuntimeError, HTTPException, MassiveError):
                logger.info("Massive market websocket bridge disconnected")
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

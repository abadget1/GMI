from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

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
from .ingestion import COMPONENTS, MarketEngine
from .schemas import AlertEvaluationRequest, AlertRuleCreate
from .store import InMemoryMarketStore, create_store
from .zones import completed_candles, detect_zones

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

VALID_SYMBOLS = {component.symbol for component in COMPONENTS} | {"GMI"}


def _store(request: Request) -> InMemoryMarketStore:
    return request.app.state.store


def _alert_engine(request: Request) -> AlertEngine:
    return request.app.state.alert_engine


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        store = await create_store(settings)
        alerts = AlertEngine()
        engine = MarketEngine(store, settings, alerts)
        app.state.store = store
        app.state.alert_engine = alerts
        app.state.market_engine = engine
        await engine.initialize(periods=min(120, max(20, settings.history_limit - 1)))
        ingestion_task = asyncio.create_task(engine.run(), name="market-ingestion")
        try:
            yield
        finally:
            await engine.stop()
            try:
                await ingestion_task
            except asyncio.CancelledError:
                pass
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
        snapshot = await _store(request).latest_snapshot()
        return {
            "status": "ok" if snapshot else "starting",
            "version": __version__,
            "sequence": snapshot.sequence if snapshot else 0,
            "server_time": datetime.now(timezone.utc),
        }

    @app.get(f"{settings.api_prefix}/assets", tags=["markets"])
    async def assets() -> dict:
        return {
            "index": {
                "symbol": "GMI",
                "name": "Global Market Index",
                "base_value": 1_000.0,
                "methodology": "fixed-reference normalized weighted return index",
            },
            "components": primitive(COMPONENTS),
            "timeframes": [timeframe.value for timeframe in Timeframe],
        }

    @app.get(f"{settings.api_prefix}/snapshot", tags=["markets"])
    async def snapshot(request: Request) -> dict:
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
        if normalized_symbol not in VALID_SYMBOLS:
            raise HTTPException(
                status_code=404,
                detail=f"unknown symbol; choose one of {sorted(VALID_SYMBOLS)}",
            )
        values = await _store(request).get_candles(
            normalized_symbol, timeframe, limit
        )
        return {
            "symbol": normalized_symbol,
            "timeframe": timeframe.value,
            "count": len(values),
            "candles": primitive(values),
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
        if normalized_symbol not in VALID_SYMBOLS:
            raise HTTPException(status_code=404, detail="unknown symbol")
        history = await _store(request).get_candles(
            normalized_symbol, timeframe, settings.history_limit
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
            "timeframe": timeframe.value,
            "count": len(filtered),
            "zones": primitive(filtered),
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
        if symbol not in VALID_SYMBOLS:
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
        if symbol not in VALID_SYMBOLS:
            raise HTTPException(status_code=404, detail="unknown symbol")
        history = await _store(request).get_candles(
            symbol, payload.timeframe, settings.history_limit
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

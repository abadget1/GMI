from __future__ import annotations

import asyncio
import json
import logging
from collections import defaultdict, deque

from .config import Settings
from .domain import Candle, MarketSnapshot, Timeframe, primitive

logger = logging.getLogger(__name__)


class InMemoryMarketStore:
    """Concurrency-safe cache and bounded in-process broadcast bus."""

    def __init__(self, history_limit: int = 500) -> None:
        self.history_limit = history_limit
        self._candles: dict[tuple[str, Timeframe], deque[Candle]] = defaultdict(
            lambda: deque(maxlen=self.history_limit)
        )
        self._snapshot: MarketSnapshot | None = None
        self._subscribers: set[asyncio.Queue[MarketSnapshot]] = set()
        self._lock = asyncio.Lock()

    async def open(self) -> None:
        return None

    async def close(self) -> None:
        async with self._lock:
            self._subscribers.clear()

    async def upsert_candle(self, candle: Candle) -> None:
        async with self._lock:
            history = self._candles[(candle.symbol, candle.timeframe)]
            if history and history[-1].timestamp == candle.timestamp:
                history[-1] = candle
            elif not history or history[-1].timestamp < candle.timestamp:
                history.append(candle)
            else:
                raise ValueError("candles must be upserted in chronological order")

    async def get_candles(
        self, symbol: str, timeframe: Timeframe, limit: int = 200
    ) -> list[Candle]:
        async with self._lock:
            history = self._candles.get((symbol, timeframe), ())
            return list(history)[-limit:]

    async def publish(self, snapshot: MarketSnapshot) -> None:
        async with self._lock:
            self._snapshot = snapshot
            subscribers = tuple(self._subscribers)
        for queue in subscribers:
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            queue.put_nowait(snapshot)

    async def latest_snapshot(self) -> MarketSnapshot | None:
        async with self._lock:
            return self._snapshot

    async def subscribe(self) -> asyncio.Queue[MarketSnapshot]:
        queue: asyncio.Queue[MarketSnapshot] = asyncio.Queue(maxsize=2)
        async with self._lock:
            self._subscribers.add(queue)
        return queue

    async def unsubscribe(self, queue: asyncio.Queue[MarketSnapshot]) -> None:
        async with self._lock:
            self._subscribers.discard(queue)


class RedisMirroredMarketStore(InMemoryMarketStore):
    """Local low-latency bus with Redis durability/cache mirroring.

    Redis is deliberately a mirror here: WebSocket backpressure remains local,
    while latest snapshots and bounded candle histories can be shared by API
    replicas. A production deployment can replace this class with Redis Streams
    without changing the engine interface.
    """

    def __init__(self, redis_url: str, history_limit: int = 500) -> None:
        super().__init__(history_limit)
        self.redis_url = redis_url
        self._redis = None

    async def open(self) -> None:
        from redis.asyncio import Redis

        self._redis = Redis.from_url(self.redis_url, decode_responses=True)
        await self._redis.ping()

    async def close(self) -> None:
        await super().close()
        if self._redis is not None:
            await self._redis.aclose()

    async def _fall_back_after_redis_error(self) -> None:
        logger.exception("Redis mirror failed; continuing with in-memory cache")
        redis = self._redis
        self._redis = None
        if redis is not None:
            try:
                await redis.aclose()
            except Exception:
                logger.debug("Redis connection close failed", exc_info=True)

    async def upsert_candle(self, candle: Candle) -> None:
        await super().upsert_candle(candle)
        if self._redis is None:
            return
        key = f"gmi:candles:{candle.symbol}:{candle.timeframe.value}"
        score = candle.timestamp.timestamp()
        payload = json.dumps(primitive(candle), separators=(",", ":"))
        try:
            async with self._redis.pipeline(transaction=False) as pipeline:
                pipeline.zremrangebyscore(key, score, score)
                pipeline.zadd(key, {payload: score})
                pipeline.zremrangebyrank(key, 0, -(self.history_limit + 1))
                await pipeline.execute()
        except Exception:
            await self._fall_back_after_redis_error()

    async def publish(self, snapshot: MarketSnapshot) -> None:
        await super().publish(snapshot)
        if self._redis is not None:
            payload = json.dumps(primitive(snapshot), separators=(",", ":"))
            try:
                await self._redis.set("gmi:snapshot:latest", payload, ex=60)
                await self._redis.publish("gmi:snapshots", payload)
            except Exception:
                await self._fall_back_after_redis_error()


async def create_store(settings: Settings) -> InMemoryMarketStore:
    if settings.redis_url:
        store = RedisMirroredMarketStore(
            settings.redis_url, history_limit=settings.history_limit
        )
        try:
            await store.open()
            logger.info("Redis market cache connected")
            return store
        except Exception:
            logger.exception("Redis unavailable; falling back to in-memory cache")
            await store.close()
    store = InMemoryMarketStore(history_limit=settings.history_limit)
    await store.open()
    return store

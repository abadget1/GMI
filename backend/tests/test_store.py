import asyncio
from datetime import datetime, timezone
import unittest

from app.domain import Candle, Timeframe
from app.store import InMemoryMarketStore


class StoreTests(unittest.TestCase):
    def test_store_upserts_current_bucket_and_bounds_history(self) -> None:
        async def scenario() -> None:
            store = InMemoryMarketStore(history_limit=2)
            timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
            first = Candle("GMI", Timeframe.M15, timestamp, 100, 102, 99, 101)
            update = Candle("GMI", Timeframe.M15, timestamp, 100, 103, 98, 102)
            await store.upsert_candle(first)
            await store.upsert_candle(update)

            history = await store.get_candles("GMI", Timeframe.M15)
            self.assertEqual(history, [update])

        asyncio.run(scenario())

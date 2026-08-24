import asyncio
import unittest

from app.alerts import AlertEngine
from app.config import Settings
from app.ingestion import COMPONENTS, TIMEFRAMES, MarketEngine
from app.store import InMemoryMarketStore


class IngestionContinuityTests(unittest.TestCase):
    def test_initialized_timeframes_join_the_live_feed_without_a_gap(self) -> None:
        async def scenario() -> None:
            settings = Settings(
                redis_url=None,
                simulation_interval_seconds=60,
                history_limit=60,
                random_seed=23,
            )
            store = InMemoryMarketStore(history_limit=settings.history_limit)
            engine = MarketEngine(store, settings, AlertEngine())
            await engine.initialize(periods=24)

            for component in COMPONENTS:
                for timeframe in TIMEFRAMES:
                    history = await store.get_candles(
                        component.symbol, timeframe, limit=30
                    )
                    self.assertEqual(len(history), 25)
                    last_completed, first_live = history[-2:]

                    terminal_error = abs(
                        last_completed.close / component.reference_price - 1
                    )
                    opening_gap = abs(
                        first_live.open / last_completed.close - 1
                    )
                    live_move = abs(first_live.close / first_live.open - 1)

                    self.assertLess(terminal_error, 1e-12)
                    self.assertLess(opening_gap, 1e-12)
                    self.assertLess(live_move, 0.01)

        asyncio.run(scenario())


if __name__ == "__main__":
    unittest.main()

from datetime import datetime, timedelta, timezone
import unittest

from app.domain import Candle, Timeframe, ZoneSide
from app.zones import detect_zones


START = datetime(2026, 2, 2, 14, 30, tzinfo=timezone.utc)


def make_candle(
    index: int, opening: float, high: float, low: float, close: float
) -> Candle:
    return Candle(
        symbol="SPX",
        timeframe=Timeframe.M15,
        timestamp=START + timedelta(minutes=15 * index),
        open=opening,
        high=high,
        low=low,
        close=close,
        volume=1_000,
    )


class ZoneDetectionTests(unittest.TestCase):
    def test_detects_virgin_demand_zone_with_structure_metadata(self) -> None:
        candles = [
            make_candle(0, 100, 102, 99, 101),
            make_candle(1, 101, 103, 100, 102),
            make_candle(2, 102, 103, 99, 100),  # last opposing/base candle
            make_candle(3, 100, 105, 99.8, 104),
            make_candle(4, 104, 109, 103.5, 108),
            make_candle(5, 108, 112, 107.5, 111),
        ]

        zones = detect_zones(candles)
        demand = next(zone for zone in zones if zone.side is ZoneSide.DEMAND)

        self.assertEqual(demand.lower, 99)
        self.assertEqual(demand.upper, 102)
        self.assertEqual(demand.proximal, 102)
        self.assertEqual(demand.distal, 99)
        self.assertTrue(demand.virgin)
        self.assertEqual(demand.impulse_candles, 3)
        self.assertTrue(demand.fair_value_gap)
        self.assertTrue(demand.break_of_structure)
        self.assertFalse(demand.trend_aligned)
        self.assertGreaterEqual(demand.quality_score, 80)

    def test_marks_zone_tested_when_price_reenters_after_impulse(self) -> None:
        candles = [
            make_candle(0, 100, 102, 99, 101),
            make_candle(1, 101, 103, 100, 102),
            make_candle(2, 102, 103, 99, 100),
            make_candle(3, 100, 105, 99.8, 104),
            make_candle(4, 104, 109, 103.5, 108),
            make_candle(5, 108, 112, 107.5, 111),
            make_candle(6, 111, 112, 101, 105),
        ]

        demand = next(
            zone for zone in detect_zones(candles) if zone.side is ZoneSide.DEMAND
        )
        self.assertFalse(demand.virgin)
        self.assertEqual(demand.touch_count, 1)
        self.assertEqual(detect_zones(candles, include_tested=False), [])

    def test_excludes_zone_after_a_distal_close_invalidation(self) -> None:
        candles = [
            make_candle(0, 100, 102, 99, 101),
            make_candle(1, 101, 103, 100, 102),
            make_candle(2, 102, 103, 99, 100),
            make_candle(3, 100, 105, 99.8, 104),
            make_candle(4, 104, 109, 103.5, 108),
            make_candle(5, 108, 112, 107.5, 111),
            make_candle(6, 111, 112, 97, 98),
        ]

        self.assertFalse(
            any(zone.side is ZoneSide.DEMAND for zone in detect_zones(candles))
        )

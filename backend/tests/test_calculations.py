from datetime import datetime, timezone
import unittest

from app.calculations import calculate_composite_candle, calculate_pressure_score
from app.domain import Candle, PressureInput, Timeframe


NOW = datetime(2026, 1, 5, 14, 30, tzinfo=timezone.utc)


def candle(
    symbol: str,
    opening: float,
    high: float,
    low: float,
    close: float,
) -> Candle:
    return Candle(symbol, Timeframe.M15, NOW, opening, high, low, close, 100)


class CalculationTests(unittest.TestCase):
    def test_composite_uses_normalized_weighted_levels(self) -> None:
        result = calculate_composite_candle(
            [
                candle("A", 100, 110, 90, 105),
                candle("B", 1_000, 1_010, 970, 980),
            ],
            {"A": 100, "B": 1_000},
            {"A": 0.25, "B": 0.75},
        )

        self.assertAlmostEqual(result.open, 1_000)
        self.assertAlmostEqual(result.high, 1_032.5)
        self.assertAlmostEqual(result.low, 952.5)
        self.assertAlmostEqual(result.close, 997.5)

    def test_composite_is_invariant_to_component_quote_scale(self) -> None:
        baseline = calculate_composite_candle(
            [candle("A", 100, 105, 98, 103), candle("B", 500, 510, 490, 505)],
            {"A": 100, "B": 500},
        )
        rescaled = calculate_composite_candle(
            [
                candle("A", 100, 105, 98, 103),
                candle("B", 5_000, 5_100, 4_900, 5_050),
            ],
            {"A": 100, "B": 5_000},
        )

        self.assertEqual(rescaled.open, baseline.open)
        self.assertEqual(rescaled.high, baseline.high)
        self.assertEqual(rescaled.low, baseline.low)
        self.assertEqual(rescaled.close, baseline.close)

    def test_composite_rejects_invalid_reference(self) -> None:
        with self.assertRaisesRegex(ValueError, "reference"):
            calculate_composite_candle(
                [candle("A", 100, 105, 98, 103)],
                {"A": 0},
            )

    def test_pressure_score_sign_and_bounds(self) -> None:
        demand = calculate_pressure_score(
            PressureInput("x", "X", "Energy", 1, -5, -5, 3, 1)
        )
        supply = calculate_pressure_score(
            PressureInput("x", "X", "Energy", -1, 5, 5, -3, 0)
        )

        self.assertEqual(demand.score, 100)
        self.assertEqual(demand.state, "demand")
        self.assertEqual(supply.score, -90)
        self.assertEqual(supply.state, "supply")
        self.assertLessEqual(0, demand.confidence)
        self.assertLessEqual(demand.confidence, 1)

    def test_domain_rejects_non_finite_vendor_values(self) -> None:
        with self.assertRaisesRegex(ValueError, "finite"):
            candle("A", 100, float("nan"), 98, 101)
        with self.assertRaisesRegex(ValueError, "finite"):
            calculate_pressure_score(
                PressureInput("x", "X", "Energy", float("inf"), 0, 0, 0, 0)
            )

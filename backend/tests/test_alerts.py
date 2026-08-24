from datetime import datetime, timedelta, timezone
import unittest

from app.alerts import AlertEngine, distance_to_zone_pct, rule_matches
from app.domain import AlertMode, AlertRule, Timeframe, Zone, ZoneSide, primitive


NOW = datetime(2026, 2, 2, 15, 0, tzinfo=timezone.utc)


def zone() -> Zone:
    return Zone(
        id="zone-1",
        symbol="GMI",
        timeframe=Timeframe.M15,
        side=ZoneSide.DEMAND,
        lower=90,
        upper=100,
        proximal=100,
        distal=90,
        base_timestamp=NOW - timedelta(hours=1),
        impulse_start=NOW - timedelta(minutes=45),
        impulse_end=NOW - timedelta(minutes=15),
        impulse_candles=3,
        quality_score=95,
        virgin=True,
        touch_count=0,
        trend_aligned=True,
        fair_value_gap=True,
        break_of_structure=True,
        rationale="test",
    )


def rule(mode: AlertMode, **overrides) -> AlertRule:
    values = {
        "id": f"rule-{mode.value}",
        "symbol": "GMI",
        "zone_side": ZoneSide.DEMAND,
        "mode": mode,
        "threshold_pct": 2,
        "cooldown_seconds": 60,
    }
    values.update(overrides)
    return AlertRule(**values)


class AlertTests(unittest.TestCase):
    def test_alert_modes_are_distinct(self) -> None:
        active_zone = zone()
        self.assertTrue(
            rule_matches(
                rule(AlertMode.APPROACH),
                active_zone,
                previous_price=105,
                current_price=102,
            )
        )
        self.assertFalse(
            rule_matches(
                rule(AlertMode.APPROACH),
                active_zone,
                previous_price=102,
                current_price=99,
            )
        )
        self.assertTrue(
            rule_matches(
                rule(AlertMode.CROSS),
                active_zone,
                previous_price=102,
                current_price=99,
            )
        )
        self.assertTrue(
            rule_matches(
                rule(AlertMode.INSIDE),
                active_zone,
                previous_price=None,
                current_price=95,
            )
        )
        self.assertAlmostEqual(distance_to_zone_pct(102, active_zone), 2 / 102 * 100)

    def test_rule_only_matches_its_configured_timeframe(self) -> None:
        hourly_rule = rule(AlertMode.INSIDE, timeframe=Timeframe.H1)
        self.assertFalse(
            rule_matches(
                hourly_rule,
                zone(),
                previous_price=101,
                current_price=95,
            )
        )

    def test_alert_engine_honors_cooldown(self) -> None:
        engine = AlertEngine()
        engine.add_rule(rule(AlertMode.INSIDE))

        first = engine.evaluate(
            symbol="GMI",
            previous_price=101,
            current_price=99,
            zones=[zone()],
            now=NOW,
        )
        during_cooldown = engine.evaluate(
            symbol="GMI",
            previous_price=99,
            current_price=98,
            zones=[zone()],
            now=NOW + timedelta(seconds=30),
        )
        after_cooldown = engine.evaluate(
            symbol="GMI",
            previous_price=98,
            current_price=97,
            zones=[zone()],
            now=NOW + timedelta(seconds=61),
        )

        self.assertEqual(len(first), 1)
        self.assertEqual(first[0].timeframe, Timeframe.M15)
        self.assertEqual(first[0].threshold_pct, 2)
        self.assertEqual(primitive(first[0])["threshold_pct"], 2)
        self.assertEqual(during_cooldown, [])
        self.assertEqual(len(after_cooldown), 1)

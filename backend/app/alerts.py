from __future__ import annotations

import uuid
from datetime import datetime, timezone

from .domain import AlertEvent, AlertMode, AlertRule, Zone


def distance_to_zone_pct(price: float, zone: Zone) -> float:
    if price <= 0:
        raise ValueError("price must be positive")
    if zone.lower <= price <= zone.upper:
        return 0.0
    boundary = zone.lower if price < zone.lower else zone.upper
    return abs(price - boundary) / price * 100.0


def rule_matches(
    rule: AlertRule,
    zone: Zone,
    *,
    previous_price: float | None,
    current_price: float,
) -> bool:
    if (
        not rule.enabled
        or rule.symbol != zone.symbol
        or rule.zone_side != zone.side
        or rule.timeframe != zone.timeframe
    ):
        return False
    if rule.zone_id is not None and rule.zone_id != zone.id:
        return False

    inside = zone.lower <= current_price <= zone.upper
    if rule.mode is AlertMode.INSIDE:
        return inside
    if rule.mode is AlertMode.APPROACH:
        return not inside and distance_to_zone_pct(current_price, zone) <= rule.threshold_pct
    if previous_price is None:
        return False
    was_inside = zone.lower <= previous_price <= zone.upper
    crossed_lower = (previous_price < zone.lower <= current_price) or (
        previous_price > zone.lower >= current_price
    )
    crossed_upper = (previous_price < zone.upper <= current_price) or (
        previous_price > zone.upper >= current_price
    )
    return was_inside != inside or crossed_lower or crossed_upper


class AlertEngine:
    def __init__(self) -> None:
        self._rules: dict[str, AlertRule] = {}
        self._last_triggered: dict[tuple[str, str], datetime] = {}

    def list_rules(self) -> list[AlertRule]:
        return list(self._rules.values())

    def add_rule(self, rule: AlertRule) -> AlertRule:
        if rule.threshold_pct < 0:
            raise ValueError("threshold_pct cannot be negative")
        if rule.cooldown_seconds < 0:
            raise ValueError("cooldown_seconds cannot be negative")
        self._rules[rule.id] = rule
        return rule

    def remove_rule(self, rule_id: str) -> bool:
        return self._rules.pop(rule_id, None) is not None

    def evaluate(
        self,
        *,
        symbol: str,
        previous_price: float | None,
        current_price: float,
        zones: list[Zone] | tuple[Zone, ...],
        now: datetime | None = None,
    ) -> list[AlertEvent]:
        now = now or datetime.now(timezone.utc)
        events: list[AlertEvent] = []
        for rule in self._rules.values():
            if rule.symbol != symbol:
                continue
            for zone in zones:
                if not rule_matches(
                    rule,
                    zone,
                    previous_price=previous_price,
                    current_price=current_price,
                ):
                    continue
                cooldown_key = (rule.id, zone.id)
                last = self._last_triggered.get(cooldown_key)
                if last and (now - last).total_seconds() < rule.cooldown_seconds:
                    continue
                distance = distance_to_zone_pct(current_price, zone)
                event = AlertEvent(
                    id=str(uuid.uuid4()),
                    rule_id=rule.id,
                    zone_id=zone.id,
                    symbol=symbol,
                    timeframe=zone.timeframe,
                    mode=rule.mode,
                    side=zone.side,
                    price=round(current_price, 6),
                    distance_pct=round(distance, 4),
                    threshold_pct=rule.threshold_pct,
                    triggered_at=now,
                    message=(
                        f"{symbol} {rule.mode.value}: {zone.side.value} zone "
                        f"{zone.lower:.2f}-{zone.upper:.2f}"
                    ),
                )
                self._last_triggered[cooldown_key] = now
                events.append(event)
        return events

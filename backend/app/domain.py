from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from math import isfinite
from typing import Any


class Timeframe(str, Enum):
    M15 = "15m"
    M30 = "30m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"

    @property
    def seconds(self) -> int:
        return {
            Timeframe.M15: 15 * 60,
            Timeframe.M30: 30 * 60,
            Timeframe.H1: 60 * 60,
            Timeframe.H4: 4 * 60 * 60,
            Timeframe.D1: 24 * 60 * 60,
        }[self]


class ZoneSide(str, Enum):
    DEMAND = "demand"
    SUPPLY = "supply"


class AlertMode(str, Enum):
    APPROACH = "approach"
    CROSS = "cross"
    INSIDE = "inside"


@dataclass(frozen=True, slots=True)
class Candle:
    symbol: str
    timeframe: Timeframe
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    def __post_init__(self) -> None:
        if self.timestamp.tzinfo is None or self.timestamp.utcoffset() is None:
            raise ValueError("candle timestamp must be timezone-aware")
        prices = (self.open, self.high, self.low, self.close)
        if any(not isfinite(value) or value <= 0 for value in prices):
            raise ValueError("candle prices must be finite and positive")
        if not isfinite(self.volume) or self.volume < 0:
            raise ValueError("candle volume must be finite and non-negative")
        if self.low > min(self.open, self.close) or self.high < max(
            self.open, self.close
        ):
            raise ValueError("OHLC values are inconsistent")
        if self.low > self.high:
            raise ValueError("candle low cannot exceed high")


@dataclass(frozen=True, slots=True)
class ComponentSpec:
    symbol: str
    name: str
    reference_price: float
    weight: float
    region: str = "United States"
    asset_class: str = "equity_index"

    def __post_init__(self) -> None:
        if not self.symbol.strip():
            raise ValueError("component symbol cannot be empty")
        if not isfinite(self.reference_price) or self.reference_price <= 0:
            raise ValueError("component reference price must be finite and positive")
        if not isfinite(self.weight) or self.weight < 0:
            raise ValueError("component weight must be finite and non-negative")


@dataclass(frozen=True, slots=True)
class PressureInput:
    key: str
    label: str
    group: str
    order_book_imbalance: float
    inventory_change_pct: float
    flow_change_pct: float
    momentum_pct: float
    logistics_stress: float

    def __post_init__(self) -> None:
        values = (
            self.order_book_imbalance,
            self.inventory_change_pct,
            self.flow_change_pct,
            self.momentum_pct,
            self.logistics_stress,
        )
        if any(not isfinite(value) for value in values):
            raise ValueError("pressure inputs must be finite")


@dataclass(frozen=True, slots=True)
class PressureScore:
    key: str
    label: str
    group: str
    score: float
    state: str
    confidence: float
    drivers: dict[str, float]


@dataclass(frozen=True, slots=True)
class Zone:
    id: str
    symbol: str
    timeframe: Timeframe
    side: ZoneSide
    lower: float
    upper: float
    proximal: float
    distal: float
    base_timestamp: datetime
    impulse_start: datetime
    impulse_end: datetime
    impulse_candles: int
    quality_score: float
    virgin: bool
    touch_count: int
    trend_aligned: bool
    fair_value_gap: bool
    break_of_structure: bool
    rationale: str

    def __post_init__(self) -> None:
        coordinates = (self.lower, self.upper, self.proximal, self.distal)
        if any(not isfinite(value) or value <= 0 for value in coordinates):
            raise ValueError("zone coordinates must be finite and positive")
        if self.lower > self.upper:
            raise ValueError("zone lower bound cannot exceed upper bound")
        if not isfinite(self.quality_score) or not 0 <= self.quality_score <= 100:
            raise ValueError("zone quality score must be between 0 and 100")
        if self.touch_count < 0:
            raise ValueError("zone touch count cannot be negative")
        timestamps = (self.base_timestamp, self.impulse_start, self.impulse_end)
        if any(value.tzinfo is None or value.utcoffset() is None for value in timestamps):
            raise ValueError("zone timestamps must be timezone-aware")
        if not self.base_timestamp <= self.impulse_start <= self.impulse_end:
            raise ValueError("zone timestamps must be chronologically ordered")


@dataclass(frozen=True, slots=True)
class AlertRule:
    id: str
    symbol: str
    zone_side: ZoneSide
    mode: AlertMode
    timeframe: Timeframe = Timeframe.M15
    threshold_pct: float = 0.5
    zone_id: str | None = None
    enabled: bool = True
    cooldown_seconds: int = 300
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self) -> None:
        if not self.id.strip() or not self.symbol.strip():
            raise ValueError("alert id and symbol cannot be empty")
        if not isfinite(self.threshold_pct) or self.threshold_pct < 0:
            raise ValueError("alert threshold must be finite and non-negative")
        if self.cooldown_seconds < 0:
            raise ValueError("alert cooldown cannot be negative")
        if self.created_at.tzinfo is None or self.created_at.utcoffset() is None:
            raise ValueError("alert creation timestamp must be timezone-aware")


@dataclass(frozen=True, slots=True)
class AlertEvent:
    id: str
    rule_id: str
    zone_id: str
    symbol: str
    timeframe: Timeframe
    mode: AlertMode
    side: ZoneSide
    price: float
    distance_pct: float
    threshold_pct: float
    triggered_at: datetime
    message: str

    def __post_init__(self) -> None:
        if not isfinite(self.price) or self.price <= 0:
            raise ValueError("alert event price must be finite and positive")
        percentages = (self.distance_pct, self.threshold_pct)
        if any(not isfinite(value) or value < 0 for value in percentages):
            raise ValueError("alert event percentages must be finite and non-negative")
        if self.triggered_at.tzinfo is None or self.triggered_at.utcoffset() is None:
            raise ValueError("alert event timestamp must be timezone-aware")


@dataclass(frozen=True, slots=True)
class MarketSnapshot:
    sequence: int
    generated_at: datetime
    prices: dict[str, float]
    changes_pct: dict[str, float]
    composite: dict[str, Candle]
    pressure: tuple[PressureScore, ...]
    zones: dict[str, tuple[Zone, ...]]
    alerts: tuple[AlertEvent, ...] = ()
    zones_by_timeframe: dict[str, dict[str, tuple[Zone, ...]]] = field(
        default_factory=dict
    )


def primitive(value: Any) -> Any:
    """Convert domain dataclasses/enums/datetimes to JSON-compatible values."""

    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if isinstance(value, Enum):
        return value.value
    if hasattr(value, "__dataclass_fields__"):
        return primitive(asdict(value))
    if isinstance(value, dict):
        return {str(key): primitive(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [primitive(item) for item in value]
    return value

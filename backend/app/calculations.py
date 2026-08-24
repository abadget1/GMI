from __future__ import annotations

from collections.abc import Mapping, Sequence
from math import isfinite

from .domain import Candle, PressureInput, PressureScore


def _normalized_weights(
    symbols: Sequence[str], weights: Mapping[str, float] | None
) -> dict[str, float]:
    raw = {symbol: (weights[symbol] if weights else 1.0) for symbol in symbols}
    if any(not isfinite(value) or value < 0 for value in raw.values()):
        raise ValueError("weights must be finite and non-negative")
    total = sum(raw.values())
    if total <= 0:
        raise ValueError("at least one component weight must be positive")
    return {symbol: value / total for symbol, value in raw.items()}


def calculate_composite_candle(
    components: Sequence[Candle],
    reference_prices: Mapping[str, float],
    weights: Mapping[str, float] | None = None,
    *,
    base_value: float = 1_000.0,
    symbol: str = "GMI",
) -> Candle:
    """Build a normalized, weighted composite OHLC candle.

    Each price is divided by a fixed reference price before aggregation. This
    avoids the dimensional error of averaging unrelated quote levels (for
    example, an S&P 500 level with a Nasdaq Composite level). High and low are
    conservative envelopes made from component highs/lows; they are not
    presented as simultaneous executable portfolio prices.
    """

    if not components:
        raise ValueError("at least one component candle is required")
    if not isfinite(base_value) or base_value <= 0:
        raise ValueError("base_value must be finite and positive")

    symbols = [candle.symbol for candle in components]
    if len(set(symbols)) != len(symbols):
        raise ValueError("component symbols must be unique")
    timestamps = {candle.timestamp for candle in components}
    timeframes = {candle.timeframe for candle in components}
    if len(timestamps) != 1 or len(timeframes) != 1:
        raise ValueError("component candles must share timestamp and timeframe")

    for component_symbol in symbols:
        reference = reference_prices.get(component_symbol)
        if reference is None or not isfinite(reference) or reference <= 0:
            raise ValueError(f"missing positive reference price for {component_symbol}")

    normalized_weights = _normalized_weights(symbols, weights)

    def level(field: str) -> float:
        return base_value * sum(
            normalized_weights[candle.symbol]
            * getattr(candle, field)
            / reference_prices[candle.symbol]
            for candle in components
        )

    composite_open = level("open")
    composite_close = level("close")
    # An OHLC envelope is deterministic even though constituent extrema can
    # occur at different instants inside the bar.
    composite_high = max(level("high"), composite_open, composite_close)
    composite_low = min(level("low"), composite_open, composite_close)

    return Candle(
        symbol=symbol,
        timeframe=components[0].timeframe,
        timestamp=components[0].timestamp,
        open=round(composite_open, 6),
        high=round(composite_high, 6),
        low=round(composite_low, 6),
        close=round(composite_close, 6),
        volume=sum(candle.volume for candle in components),
    )


def calculate_pressure_score(metric: PressureInput) -> PressureScore:
    """Return a score in [-100, 100]: negative=supply, positive=demand.

    Inputs with percentage units are clipped and normalized before weighting.
    A positive book imbalance means bid-side demand; rising inventory and
    inbound flow imply supply; positive momentum and logistics stress imply
    demand pressure or constrained effective supply.
    """

    clip = lambda value, lower, upper: min(max(value, lower), upper)
    drivers = {
        "order_book": clip(metric.order_book_imbalance, -1.0, 1.0),
        "inventory": -clip(metric.inventory_change_pct / 5.0, -1.0, 1.0),
        "flow": -clip(metric.flow_change_pct / 5.0, -1.0, 1.0),
        "momentum": clip(metric.momentum_pct / 3.0, -1.0, 1.0),
        "logistics": clip(metric.logistics_stress, 0.0, 1.0),
    }
    raw = 100.0 * (
        0.30 * drivers["order_book"]
        + 0.25 * drivers["inventory"]
        + 0.15 * drivers["flow"]
        + 0.20 * drivers["momentum"]
        + 0.10 * drivers["logistics"]
    )
    score = round(clip(raw, -100.0, 100.0), 2)
    if score >= 20:
        state = "demand"
    elif score <= -20:
        state = "supply"
    else:
        state = "balanced"

    # Confidence rises with signal magnitude and driver agreement.
    signed = [value for value in drivers.values() if abs(value) > 0.05]
    agreeing = (
        max(
            sum(value > 0 for value in signed),
            sum(value < 0 for value in signed),
        )
        / len(signed)
        if signed
        else 0.0
    )
    confidence = round(min(1.0, 0.45 * abs(score) / 100.0 + 0.55 * agreeing), 3)
    return PressureScore(
        key=metric.key,
        label=metric.label,
        group=metric.group,
        score=score,
        state=state,
        confidence=confidence,
        drivers={key: round(value, 4) for key, value in drivers.items()},
    )

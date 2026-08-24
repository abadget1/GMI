from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import datetime, timedelta
from statistics import fmean

from .domain import Candle, Timeframe, Zone, ZoneSide


def completed_candles(
    candles: Sequence[Candle], *, as_of: datetime
) -> list[Candle]:
    """Exclude the still-forming bar at a point in time."""

    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware")
    return [
        candle
        for candle in candles
        if candle.timestamp + timedelta(seconds=candle.timeframe.seconds) <= as_of
    ]


def _true_range(candle: Candle, previous_close: float | None) -> float:
    if previous_close is None:
        return candle.high - candle.low
    return max(
        candle.high - candle.low,
        abs(candle.high - previous_close),
        abs(candle.low - previous_close),
    )


def _average_true_range(candles: Sequence[Candle], end: int, lookback: int) -> float:
    start = max(0, end - lookback)
    ranges: list[float] = []
    for index in range(start, end):
        previous_close = candles[index - 1].close if index > 0 else None
        ranges.append(_true_range(candles[index], previous_close))
    nonzero = [value for value in ranges if value > 0]
    return fmean(nonzero) if nonzero else 1e-9


def _direction(candle: Candle) -> int:
    if candle.close > candle.open:
        return 1
    if candle.close < candle.open:
        return -1
    return 0


def _has_fair_value_gap(
    candles: Sequence[Candle], start: int, end: int, side: ZoneSide
) -> bool:
    # Scan three-candle windows around the departure. A bullish FVG exists
    # when candle three's low is above candle one's high; vice versa for supply.
    window_start = max(0, start - 1)
    window_end = min(len(candles) - 1, end + 1)
    for center in range(window_start + 1, window_end):
        first, third = candles[center - 1], candles[center + 1]
        if side is ZoneSide.DEMAND and third.low > first.high:
            return True
        if side is ZoneSide.SUPPLY and third.high < first.low:
            return True
    return False


def _zone_id(
    symbol: str, timeframe: Timeframe, side: ZoneSide, base: Candle
) -> str:
    raw = f"{symbol}|{timeframe.value}|{side.value}|{base.timestamp.isoformat()}"
    return hashlib.blake2s(raw.encode(), digest_size=8).hexdigest()


def detect_zones(
    candles: Sequence[Candle],
    *,
    impulse_body_atr: float = 0.55,
    atr_lookback: int = 14,
    base_lookback: int = 6,
    include_tested: bool = True,
) -> list[Zone]:
    """Detect rule-based supply/demand zones from completed OHLC candles.

    A candidate requires two or three same-direction momentum candles and the
    last opposing candle before the move. Structural metadata is returned so
    callers can explain every zone and apply stricter production filters.
    """

    if len(candles) < 4:
        return []
    symbol = candles[0].symbol
    timeframe = candles[0].timeframe
    if any(c.symbol != symbol or c.timeframe != timeframe for c in candles):
        raise ValueError("zone detection requires one symbol and timeframe")
    if any(
        candles[index].timestamp >= candles[index + 1].timestamp
        for index in range(len(candles) - 1)
    ):
        raise ValueError("candles must be in strictly ascending timestamp order")

    zones: list[Zone] = []
    seen: set[tuple[int, ZoneSide]] = set()

    for impulse_start in range(1, len(candles) - 1):
        direction = _direction(candles[impulse_start])
        if direction == 0:
            continue
        side = ZoneSide.DEMAND if direction > 0 else ZoneSide.SUPPLY
        atr = _average_true_range(candles, impulse_start, atr_lookback)

        impulse_length = 0
        for candidate_length in (3, 2):
            end = impulse_start + candidate_length
            if end > len(candles):
                continue
            sequence = candles[impulse_start:end]
            if all(
                _direction(candle) == direction
                and abs(candle.close - candle.open) >= impulse_body_atr * atr
                for candle in sequence
            ):
                aggregate_move = abs(sequence[-1].close - sequence[0].open)
                if aggregate_move >= candidate_length * impulse_body_atr * atr:
                    impulse_length = candidate_length
                    break
        if impulse_length == 0:
            continue

        opposing_direction = -direction
        base_index = next(
            (
                index
                for index in range(
                    impulse_start - 1,
                    max(-1, impulse_start - base_lookback - 1),
                    -1,
                )
                if _direction(candles[index]) == opposing_direction
            ),
            None,
        )
        if base_index is None or (base_index, side) in seen:
            continue
        seen.add((base_index, side))

        base = candles[base_index]
        impulse_end_index = impulse_start + impulse_length - 1
        impulse = candles[impulse_start : impulse_end_index + 1]
        formation = candles[base_index:impulse_start]
        proximal = base.open
        distal = (
            min(candle.low for candle in formation)
            if side is ZoneSide.DEMAND
            else max(candle.high for candle in formation)
        )
        lower, upper = sorted((proximal, distal))

        subsequent = candles[impulse_end_index + 1 :]
        invalidated = any(
            candle.close < lower
            if side is ZoneSide.DEMAND
            else candle.close > upper
            for candle in subsequent
        )
        if invalidated:
            continue
        touch_count = sum(
            candle.low <= upper and candle.high >= lower for candle in subsequent
        )
        virgin = touch_count == 0
        if not include_tested and not virgin:
            continue

        prior = candles[max(0, base_index - atr_lookback) : base_index]
        trend_sample = candles[max(0, base_index - 10) : base_index + 1]
        if side is ZoneSide.DEMAND:
            prior_extreme = max((candle.high for candle in prior), default=base.high)
            break_of_structure = max(candle.high for candle in impulse) > prior_extreme
            trend_aligned = (
                len(trend_sample) >= 3
                and trend_sample[-1].close > trend_sample[0].close
            )
        else:
            prior_extreme = min((candle.low for candle in prior), default=base.low)
            break_of_structure = min(candle.low for candle in impulse) < prior_extreme
            trend_aligned = (
                len(trend_sample) >= 3
                and trend_sample[-1].close < trend_sample[0].close
            )

        fair_value_gap = _has_fair_value_gap(
            candles, impulse_start, impulse_end_index, side
        )
        strength = min(
            1.0,
            abs(impulse[-1].close - impulse[0].open) / max(atr * impulse_length, 1e-9),
        )
        quality = (
            (30 if virgin else max(0, 20 - 5 * touch_count))
            + (20 if fair_value_gap else 0)
            + (25 if break_of_structure else 0)
            + (15 if trend_aligned else 0)
            + 10 * strength
        )
        rationale_parts = [f"{impulse_length}-candle impulsive departure"]
        rationale_parts.append("virgin zone" if virgin else f"tested {touch_count} time(s)")
        if fair_value_gap:
            rationale_parts.append("fair value gap")
        if break_of_structure:
            rationale_parts.append("break of structure")
        if trend_aligned:
            rationale_parts.append("trend aligned")

        zones.append(
            Zone(
                id=_zone_id(symbol, timeframe, side, base),
                symbol=symbol,
                timeframe=timeframe,
                side=side,
                lower=round(lower, 6),
                upper=round(upper, 6),
                proximal=round(proximal, 6),
                distal=round(distal, 6),
                base_timestamp=base.timestamp,
                impulse_start=candles[impulse_start].timestamp,
                impulse_end=candles[impulse_end_index].timestamp,
                impulse_candles=impulse_length,
                quality_score=round(min(100.0, quality), 1),
                virgin=virgin,
                touch_count=touch_count,
                trend_aligned=trend_aligned,
                fair_value_gap=fair_value_gap,
                break_of_structure=break_of_structure,
                rationale=", ".join(rationale_parts),
            )
        )

    return sorted(
        zones,
        key=lambda zone: (zone.virgin, zone.quality_score, zone.base_timestamp),
        reverse=True,
    )

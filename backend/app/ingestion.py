from __future__ import annotations

import asyncio
import logging
import math
import random
from datetime import datetime, timedelta, timezone

from .alerts import AlertEngine
from .calculations import calculate_composite_candle, calculate_pressure_score
from .config import Settings
from .domain import (
    Candle,
    ComponentSpec,
    MarketSnapshot,
    PressureInput,
    Timeframe,
)
from .store import InMemoryMarketStore
from .zones import completed_candles, detect_zones

logger = logging.getLogger(__name__)


COMPONENTS: tuple[ComponentSpec, ...] = (
    ComponentSpec(
        symbol="SPX",
        name="S&P 500",
        reference_price=6_500.0,
        weight=0.50,
    ),
    ComponentSpec(
        symbol="IXIC",
        name="Nasdaq Composite",
        reference_price=22_000.0,
        weight=0.50,
    ),
)

TIMEFRAMES: tuple[Timeframe, ...] = tuple(Timeframe)
SNAPSHOT_ZONE_LIMIT = 12

PRESSURE_SERIES: tuple[tuple[str, str, str], ...] = (
    ("crude-oil", "Crude Oil", "Energy"),
    ("natural-gas", "Natural Gas", "Energy"),
    ("wheat", "Wheat", "Agriculture"),
    ("corn", "Corn", "Agriculture"),
    ("copper", "Copper", "Industrial Metals"),
    ("aluminum", "Aluminum", "Industrial Metals"),
    ("memory", "Memory Chips", "Semiconductors"),
    ("foundry", "Foundry Capacity", "Semiconductors"),
)


def floor_timestamp(value: datetime, timeframe: Timeframe) -> datetime:
    utc_value = value.astimezone(timezone.utc)
    epoch = int(utc_value.timestamp())
    floored = epoch - epoch % timeframe.seconds
    return datetime.fromtimestamp(floored, tz=timezone.utc)


class SyntheticMarketFeed:
    """Deterministic simulator implementing the shape of a vendor adapter."""

    def __init__(self, seed: int) -> None:
        self.random = random.Random(seed)
        self.prices = {component.symbol: component.reference_price for component in COMPONENTS}

    def next_prices(self) -> dict[str, float]:
        for component in COMPONENTS:
            shock = self.random.gauss(0.00002, 0.00055)
            self.prices[component.symbol] *= math.exp(shock)
        return dict(self.prices)

    def history(
        self,
        component: ComponentSpec,
        timeframe: Timeframe,
        periods: int,
        now: datetime,
    ) -> list[Candle]:
        if periods < 1:
            raise ValueError("history periods must be positive")
        volatility = 0.0025 * math.sqrt(timeframe.seconds / Timeframe.M15.seconds)
        start = floor_timestamp(now, timeframe) - timedelta(
            seconds=timeframe.seconds * periods
        )
        price = component.reference_price * self.random.uniform(0.97, 1.01)
        candles: list[Candle] = []
        for offset in range(periods):
            timestamp = start + timedelta(seconds=timeframe.seconds * offset)
            opening = price
            closing = opening * math.exp(self.random.gauss(0.00008, volatility))
            spread = abs(self.random.gauss(volatility * 0.55, volatility * 0.2))
            high = max(opening, closing) * (1 + spread)
            low = min(opening, closing) * max(0.01, 1 - spread)
            candles.append(
                Candle(
                    symbol=component.symbol,
                    timeframe=timeframe,
                    timestamp=timestamp,
                    open=opening,
                    high=high,
                    low=low,
                    close=closing,
                    volume=self.random.uniform(500_000, 5_000_000),
                )
            )
            price = closing

        # Every timeframe is simulated independently, so its unscaled random
        # walk would otherwise finish at a different nominal price. Preserve
        # the generated return path while putting every series on the same
        # terminal anchor used by the live feed.
        scale = component.reference_price / candles[-1].close
        return [
            Candle(
                symbol=candle.symbol,
                timeframe=candle.timeframe,
                timestamp=candle.timestamp,
                open=candle.open * scale,
                high=candle.high * scale,
                low=candle.low * scale,
                close=candle.close * scale,
                volume=candle.volume,
            )
            for candle in candles
        ]


class MarketEngine:
    def __init__(
        self,
        store: InMemoryMarketStore,
        settings: Settings,
        alert_engine: AlertEngine,
    ) -> None:
        self.store = store
        self.settings = settings
        self.alert_engine = alert_engine
        self.feed = SyntheticMarketFeed(settings.random_seed)
        self.sequence = 0
        self.previous_prices: dict[tuple[str, Timeframe], float] = {}
        self._stop = asyncio.Event()

    @property
    def references(self) -> dict[str, float]:
        return {item.symbol: item.reference_price for item in COMPONENTS}

    @property
    def weights(self) -> dict[str, float]:
        return {item.symbol: item.weight for item in COMPONENTS}

    async def initialize(self, periods: int = 120) -> None:
        now = datetime.now(timezone.utc)
        for timeframe in TIMEFRAMES:
            component_histories = {
                component.symbol: self.feed.history(
                    component, timeframe, periods, now
                )
                for component in COMPONENTS
            }
            for offset in range(periods):
                components = [
                    component_histories[component.symbol][offset]
                    for component in COMPONENTS
                ]
                for candle in components:
                    await self.store.upsert_candle(candle)
                composite = calculate_composite_candle(
                    components,
                    self.references,
                    self.weights,
                )
                await self.store.upsert_candle(composite)

        latest_15m = {
            component.symbol: (
                await self.store.get_candles(component.symbol, Timeframe.M15, 1)
            )[-1].close
            for component in COMPONENTS
        }
        self.feed.prices.update(latest_15m)
        await self.step(now=now)

    async def stop(self) -> None:
        self._stop.set()

    async def run(self) -> None:
        while not self._stop.is_set():
            try:
                await asyncio.wait_for(
                    self._stop.wait(),
                    timeout=self.settings.simulation_interval_seconds,
                )
            except TimeoutError:
                try:
                    await self.step()
                except Exception:
                    logger.exception("simulated ingestion step failed")

    async def _update_component(
        self,
        *,
        symbol: str,
        price: float,
        timeframe: Timeframe,
        now: datetime,
    ) -> Candle:
        timestamp = floor_timestamp(now, timeframe)
        latest = (await self.store.get_candles(symbol, timeframe, 1))[-1]
        if latest.timestamp == timestamp:
            candle = Candle(
                symbol=symbol,
                timeframe=timeframe,
                timestamp=timestamp,
                open=latest.open,
                high=max(latest.high, price),
                low=min(latest.low, price),
                close=price,
                volume=latest.volume + self.feed.random.uniform(5_000, 25_000),
            )
        else:
            candle = Candle(
                symbol=symbol,
                timeframe=timeframe,
                timestamp=timestamp,
                open=latest.close,
                high=max(latest.close, price),
                low=min(latest.close, price),
                close=price,
                volume=self.feed.random.uniform(5_000, 25_000),
            )
        await self.store.upsert_candle(candle)
        return candle

    def _pressure(self, market_change_pct: float) -> tuple:
        values = []
        for index, (key, label, group) in enumerate(PRESSURE_SERIES):
            phase = self.sequence * 0.09 + index * 0.8
            metric = PressureInput(
                key=key,
                label=label,
                group=group,
                order_book_imbalance=max(
                    -1.0,
                    min(1.0, math.sin(phase) * 0.52 + market_change_pct / 4),
                ),
                inventory_change_pct=math.cos(phase * 0.7) * 2.8,
                flow_change_pct=math.sin(phase * 0.55 + 1.2) * 3.5,
                momentum_pct=math.sin(phase * 1.1) * 1.9,
                logistics_stress=(math.sin(phase * 0.3) + 1) / 2,
            )
            values.append(calculate_pressure_score(metric))
        return tuple(values)

    async def step(self, now: datetime | None = None) -> MarketSnapshot:
        now = now or datetime.now(timezone.utc)
        prices = self.feed.next_prices()
        composites: dict[str, Candle] = {}
        for timeframe in TIMEFRAMES:
            component_candles = [
                await self._update_component(
                    symbol=component.symbol,
                    price=prices[component.symbol],
                    timeframe=timeframe,
                    now=now,
                )
                for component in COMPONENTS
            ]
            composite = calculate_composite_candle(
                component_candles,
                self.references,
                self.weights,
            )
            await self.store.upsert_candle(composite)
            composites[timeframe.value] = composite

        # `zones` remains the legacy 15m symbol map consumed by the current
        # browser adapter. The explicit nested map publishes every supported
        # timeframe without mixing structurally different zones.
        zones: dict[str, tuple] = {}
        zones_by_timeframe: dict[str, dict[str, tuple]] = {
            timeframe.value: {} for timeframe in TIMEFRAMES
        }
        alerts = []
        for symbol in (*prices.keys(), "GMI"):
            current_price = (
                prices[symbol] if symbol in prices else composites["15m"].close
            )
            for timeframe in TIMEFRAMES:
                candles = await self.store.get_candles(symbol, timeframe, 200)
                detected = tuple(
                    detect_zones(completed_candles(candles, as_of=now))[
                        :SNAPSHOT_ZONE_LIMIT
                    ]
                )
                zones_by_timeframe[timeframe.value][symbol] = detected
                if timeframe is Timeframe.M15:
                    zones[symbol] = detected
                price_key = (symbol, timeframe)
                alerts.extend(
                    self.alert_engine.evaluate(
                        symbol=symbol,
                        previous_price=self.previous_prices.get(price_key),
                        current_price=current_price,
                        zones=detected,
                        now=now,
                    )
                )
                self.previous_prices[price_key] = current_price

        self.sequence += 1
        prices_with_composite = {**prices, "GMI": composites["15m"].close}
        changes_pct = {
            symbol: round(
                (price / self.references.get(symbol, 1_000.0) - 1) * 100,
                4,
            )
            for symbol, price in prices_with_composite.items()
        }
        average_change = sum(changes_pct.values()) / len(changes_pct)
        snapshot = MarketSnapshot(
            sequence=self.sequence,
            generated_at=now,
            prices={key: round(value, 6) for key, value in prices_with_composite.items()},
            changes_pct=changes_pct,
            composite=composites,
            pressure=self._pressure(average_change),
            zones=zones,
            alerts=tuple(alerts),
            zones_by_timeframe=zones_by_timeframe,
        )
        await self.store.publish(snapshot)
        return snapshot

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from typing import Any, Mapping

import httpx

from .config import Settings
from .domain import Candle, Timeframe, primitive


TWELVE_SYMBOLS: dict[str, str] = {
    "SPX": "SPY",
    "NDX": "QQQ",
    "DJI": "DIA",
    "EURUSD": "EUR/USD",
    "GBPUSD": "GBP/USD",
    "USDJPY": "USD/JPY",
    "BTCUSD": "BTC/USD",
    "ETHUSD": "ETH/USD",
    "SOLUSD": "SOL/USD",
    "WTI": "WTI/USD",
    "BRENT": "BRENT/USD",
    "NATURAL_GAS": "NATURALGAS/USD",
    "COPPER": "HG1",
    "WHEAT": "WHEAT/USD",
}

TWELVE_ASSET_CLASSES: dict[str, str] = {
    "SPX": "index",
    "NDX": "index",
    "DJI": "index",
    "EURUSD": "forex",
    "GBPUSD": "forex",
    "USDJPY": "forex",
    "BTCUSD": "crypto",
    "ETHUSD": "crypto",
    "SOLUSD": "crypto",
    "WTI": "commodity",
    "BRENT": "commodity",
    "NATURAL_GAS": "commodity",
    "COPPER": "commodity",
    "WHEAT": "commodity",
}


class TwelveDataError(RuntimeError):
    pass


class TwelveDataRateLimitError(TwelveDataError):
    pass


@dataclass(frozen=True, slots=True)
class TwelveSeriesResult:
    symbol: str
    requested_timeframe: Timeframe
    effective_timeframe: Timeframe
    candles: tuple[Candle, ...]
    provider_symbol: str
    fetched_at: datetime
    fallback_reason: str | None = None

    def metadata(self) -> dict[str, Any]:
        return primitive(
            {
                "provider": "twelve_data",
                "provider_symbol": self.provider_symbol,
                "requested_timeframe": self.requested_timeframe,
                "effective_timeframe": self.effective_timeframe,
                "fetched_at": self.fetched_at,
                "fallback_reason": self.fallback_reason,
            }
        )


def _number(value: Any) -> float | None:
    try:
        parsed = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return parsed if isfinite(parsed) else None


def _timestamp(value: Any) -> datetime:
    text = str(value).strip().replace("Z", "+00:00")
    parsed = datetime.fromisoformat(text)
    return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).astimezone(
        timezone.utc
    )


def _interval(timeframe: Timeframe) -> str:
    return {
        Timeframe.M15: "15min",
        Timeframe.M30: "30min",
        Timeframe.H1: "1h",
        Timeframe.H4: "4h",
        Timeframe.D1: "1day",
    }[timeframe]


class TwelveDataClient:
    """Small cached adapter for Twelve Data time-series and quote APIs."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = settings.twelve_data_api_key
        self.base_url = settings.twelve_data_base_url.rstrip("/")
        self.cache_ttl_seconds = settings.twelve_data_cache_ttl_seconds
        self.min_request_interval_seconds = settings.twelve_data_min_request_interval_seconds
        self._client = httpx.AsyncClient(
            timeout=settings.twelve_data_timeout_seconds,
            transport=transport,
            headers={"User-Agent": "Meridian-GMI/1.0"},
        )
        self._cache: dict[tuple[str, Timeframe], tuple[float, TwelveSeriesResult]] = {}
        self._stale_cache: dict[tuple[str, Timeframe], TwelveSeriesResult] = {}
        self._request_lock = asyncio.Lock()
        self._last_request_started = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def close(self) -> None:
        await self._client.aclose()

    async def _get(self, endpoint: str, params: Mapping[str, str]) -> Mapping[str, Any]:
        if not self.api_key:
            raise TwelveDataError("Twelve Data is not configured")
        async with self._request_lock:
            elapsed = time.monotonic() - self._last_request_started
            if elapsed < self.min_request_interval_seconds:
                await asyncio.sleep(self.min_request_interval_seconds - elapsed)
            self._last_request_started = time.monotonic()
            response = await self._client.get(
                f"{self.base_url}/{endpoint}",
                params={**params, "apikey": self.api_key},
            )
        if response.status_code == 429:
            raise TwelveDataRateLimitError("Twelve Data rate limit reached")
        if response.status_code >= 400:
            raise TwelveDataError(f"Twelve Data returned HTTP {response.status_code}")
        payload = response.json()
        if not isinstance(payload, Mapping):
            raise TwelveDataError("Twelve Data returned an invalid response")
        if str(payload.get("status", "ok")).casefold() == "error" or payload.get("code"):
            message = str(payload.get("message") or payload.get("code") or "provider error")
            raise TwelveDataError(message)
        return payload

    async def _get_symbol_candles(
        self, symbol: str, timeframe: Timeframe, limit: int
    ) -> TwelveSeriesResult:
        provider_symbol = TWELVE_SYMBOLS.get(symbol, symbol)
        payload = await self._get(
            "time_series",
            {
                "symbol": provider_symbol,
                "interval": _interval(timeframe),
                "outputsize": str(max(1, min(5000, limit))),
                "timezone": "UTC",
            },
        )
        values = payload.get("values")
        if not isinstance(values, list):
            raise TwelveDataError(f"No time-series values returned for {provider_symbol}")
        candles: list[Candle] = []
        for row in reversed(values):
            if not isinstance(row, Mapping):
                continue
            numbers = [_number(row.get(key)) for key in ("open", "high", "low", "close")]
            volume = _number(row.get("volume")) or 0.0
            if any(value is None for value in numbers) or volume < 0:
                continue
            try:
                candles.append(
                    Candle(
                        symbol=symbol,
                        timeframe=timeframe,
                        timestamp=_timestamp(row.get("datetime")),
                        open=numbers[0],
                        high=numbers[1],
                        low=numbers[2],
                        close=numbers[3],
                        volume=volume,
                    )
                )
            except (TypeError, ValueError):
                continue
        if not candles:
            raise TwelveDataError(f"No valid candles returned for {provider_symbol}")
        now = datetime.now(timezone.utc)
        return TwelveSeriesResult(
            symbol=symbol,
            requested_timeframe=timeframe,
            effective_timeframe=timeframe,
            candles=tuple(candles),
            provider_symbol=provider_symbol,
            fetched_at=now,
        )

    async def _get_gmi(self, timeframe: Timeframe, limit: int) -> TwelveSeriesResult:
        spy, qqq = await asyncio.gather(
            self._get_symbol_candles("SPX", timeframe, limit),
            self._get_symbol_candles("NDX", timeframe, limit),
        )
        spy_by_time = {item.timestamp: item for item in spy.candles}
        qqq_by_time = {item.timestamp: item for item in qqq.candles}
        candles: list[Candle] = []
        for timestamp in sorted(spy_by_time.keys() & qqq_by_time.keys()):
            left, right = spy_by_time[timestamp], qqq_by_time[timestamp]
            # Normalize each ETF to its first returned close before combining.
            spy_base, qqq_base = spy.candles[0].close, qqq.candles[0].close
            open_value = 1000 * 0.5 * (left.open / spy_base + right.open / qqq_base)
            high_value = 1000 * 0.5 * (left.high / spy_base + right.high / qqq_base)
            low_value = 1000 * 0.5 * (left.low / spy_base + right.low / qqq_base)
            close_value = 1000 * 0.5 * (left.close / spy_base + right.close / qqq_base)
            candles.append(
                Candle(
                    symbol="GMI",
                    timeframe=timeframe,
                    timestamp=timestamp,
                    open=open_value,
                    high=high_value,
                    low=low_value,
                    close=close_value,
                    volume=left.volume + right.volume,
                )
            )
        if not candles:
            raise TwelveDataError("SPY and QQQ series have no aligned timestamps")
        return TwelveSeriesResult(
            symbol="GMI",
            requested_timeframe=timeframe,
            effective_timeframe=timeframe,
            candles=tuple(candles[-limit:]),
            provider_symbol="SPY+QQQ",
            fetched_at=datetime.now(timezone.utc),
        )

    async def get_candles(self, symbol: str, timeframe: Timeframe, limit: int = 500) -> TwelveSeriesResult:
        normalized = symbol.upper()
        key = (normalized, timeframe)
        cached = self._cache.get(key)
        if cached and time.monotonic() - cached[0] < self.cache_ttl_seconds:
            return cached[1]
        try:
            result = await self._get_gmi(timeframe, limit) if normalized == "GMI" else await self._get_symbol_candles(normalized, timeframe, limit)
        except TwelveDataError:
            stale = self._stale_cache.get(key)
            if stale:
                return stale
            raise
        self._cache[key] = (time.monotonic(), result)
        self._stale_cache[key] = result
        return result

    async def get_board(self, asset_class: str | None = None, limit: int = 8) -> list[dict[str, Any]]:
        symbols = [
            symbol
            for symbol, kind in TWELVE_ASSET_CLASSES.items()
            if asset_class is None or kind == asset_class
        ][: max(1, min(8, int(limit)))]
        items: list[dict[str, Any]] = []
        for symbol in symbols:
            try:
                result = await self.get_candles(symbol, Timeframe.D1, 2)
            except TwelveDataError:
                continue
            latest = result.candles[-1] if result.candles else None
            previous = result.candles[-2] if len(result.candles) > 1 else None
            if not latest:
                continue
            change = ((latest.close / previous.close) - 1) * 100 if previous and previous.close > 0 else None
            items.append({
                "symbol": symbol,
                "name": symbol,
                "asset_class": TWELVE_ASSET_CLASSES[symbol],
                "price": latest.close,
                "change_percent": change,
                "timestamp": latest.timestamp,
                "volume": latest.volume,
                "provider": "twelve_data",
            })
        return items

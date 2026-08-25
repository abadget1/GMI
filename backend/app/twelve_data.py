from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import isfinite
from typing import Any, Mapping

import httpx

from .config import Settings
from .domain import Candle, Timeframe, primitive


TWELVE_SYMBOLS: dict[str, str] = {
    # ETFs are private GMI constituents and are not exposed in the asset list.
    "SPY": "SPY",
    "QQQ": "QQQ",
    # Public continuous futures identifiers.
    "RTY": "RTY1!",
    "ES": "ES1!",
    "NQ": "NQ1!",
    "YM": "YM1!",
    "NKD": "NKD1!",
    "RB": "RB1!",
    "CL": "CL1!",
    "QM": "QM1!",
    "HO": "HO1!",
    "NG": "NG1!",
    "QG": "QG1!",
    "GC": "GC1!",
    "SI": "SI1!",
    "HG": "HG1!",
}

TWELVE_ASSET_CLASSES: dict[str, str] = {
    "RTY": "index",
    "ES": "index",
    "NQ": "index",
    "YM": "index",
    "NKD": "index",
    "RB": "commodity",
    "CL": "commodity",
    "QM": "commodity",
    "HO": "commodity",
    "NG": "commodity",
    "QG": "commodity",
    "GC": "commodity",
    "SI": "commodity",
    "HG": "commodity",
}

TWELVE_ASSET_NAMES: dict[str, str] = {
    "RTY": "Russell 2000 E-mini",
    "ES": "S&P 500 E-mini",
    "NQ": "Nasdaq-100 E-mini",
    "YM": "Dow Jones E-mini",
    "NKD": "Nikkei 225 E-mini",
    "RB": "RBOB Gasoline",
    "CL": "WTI Crude Oil",
    "QM": "E-mini Crude Oil",
    "HO": "Heating Oil",
    "NG": "Natural Gas",
    "QG": "E-mini Natural Gas",
    "GC": "Gold",
    "SI": "Silver",
    "HG": "Copper",
}

TWELVE_SYMBOL_ALIASES: dict[str, str] = {
    "SPX": "SPY",
    "NDX": "QQQ",
    "IXIC": "QQQ",
}

TWELVE_PUBLIC_SYMBOLS: tuple[str, ...] = tuple(TWELVE_ASSET_CLASSES)


def canonical_symbol(value: str) -> str:
    normalized = value.strip().upper()
    return TWELVE_SYMBOL_ALIASES.get(normalized, normalized)


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
        self._quote_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._board_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._request_lock = asyncio.Lock()
        self._last_request_started = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def close(self) -> None:
        await self._client.aclose()

    async def open_quote_stream(self):
        """Open Twelve Data's upstream quote stream for the backend WS bridge."""
        if not self.api_key:
            raise TwelveDataError("Twelve Data is not configured")
        try:
            import websockets
        except ImportError as exc:
            raise TwelveDataError("WebSocket support is not installed") from exc
        connection = await websockets.connect(
            f"wss://ws.twelvedata.com/v1/quotes/price?apikey={self.api_key}",
            ping_interval=10,
            ping_timeout=10,
        )
        await connection.send(
            json.dumps(
                {
                    "action": "subscribe",
                    "params": {"symbols": ",".join(TWELVE_SYMBOLS.values())},
                }
            )
        )
        return connection

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
        symbol = canonical_symbol(symbol)
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

    def _quote_item(self, symbol: str, payload: Mapping[str, Any]) -> dict[str, Any]:
        provider_symbol = TWELVE_SYMBOLS.get(symbol, symbol)
        price = _number(payload.get("close") or payload.get("price"))
        if price is None or price <= 0:
            raise TwelveDataError(f"No current quote returned for {provider_symbol}")
        previous = _number(payload.get("previous_close"))
        change_percent = _number(payload.get("percent_change"))
        if change_percent is None and previous and previous > 0:
            change_percent = ((price / previous) - 1) * 100
        try:
            quote_timestamp = _timestamp(payload["datetime"]) if payload.get("datetime") else datetime.now(timezone.utc)
        except (KeyError, TypeError, ValueError):
            quote_timestamp = datetime.now(timezone.utc)
        # Twelve Data can return a date-only/local-market timestamp for quote
        # snapshots. Never advertise a future update to the UI; the quote was
        # fetched now, so use the fetch time when the provider timestamp is
        # materially ahead of the server clock.
        now = datetime.now(timezone.utc)
        if quote_timestamp > now + timedelta(minutes=5):
            quote_timestamp = now
        item = {
            "symbol": symbol,
            "name": TWELVE_ASSET_NAMES.get(symbol, symbol),
            "asset_class": TWELVE_ASSET_CLASSES.get(symbol, "market"),
            "price": price,
            "change_percent": change_percent,
            "timestamp": quote_timestamp,
            "volume": _number(payload.get("volume")) or 0.0,
            "provider": "twelve_data",
            "provider_symbol": provider_symbol,
        }
        self._quote_cache[symbol] = (time.monotonic(), item)
        return item

    async def _get_quote(self, symbol: str) -> dict[str, Any]:
        symbol = canonical_symbol(symbol)
        cached = self._quote_cache.get(symbol)
        if cached and time.monotonic() - cached[0] < min(30.0, self.cache_ttl_seconds):
            return cached[1]
        payload = await self._get("quote", {"symbol": TWELVE_SYMBOLS.get(symbol, symbol)})
        return self._quote_item(symbol, payload)

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
        normalized = canonical_symbol(symbol)
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
        cache_key = f"{asset_class or '*'}:{max(1, min(len(TWELVE_SYMBOLS), int(limit)))}"
        cached = self._board_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < min(30.0, self.cache_ttl_seconds):
            return cached[1]
        symbols = [
            symbol
            for symbol, kind in TWELVE_ASSET_CLASSES.items()
            if asset_class is None or kind == asset_class
        ][: max(1, min(len(TWELVE_SYMBOLS), int(limit)))]
        items: list[dict[str, Any]] = []
        provider_symbols = [TWELVE_SYMBOLS[symbol] for symbol in symbols]
        try:
            payload = await self._get("quote", {"symbol": ",".join(provider_symbols)})
            for symbol, provider_symbol in zip(symbols, provider_symbols):
                raw = payload.get(provider_symbol) or payload.get(symbol)
                if not isinstance(raw, Mapping):
                    # A one-symbol batch may return the quote object directly.
                    raw = payload if str(payload.get("symbol", "")).upper() == provider_symbol.upper() else None
                if isinstance(raw, Mapping):
                    try:
                        items.append(self._quote_item(symbol, raw))
                    except TwelveDataError:
                        continue
        except TwelveDataRateLimitError:
            raise
        except TwelveDataError:
            # Preserve historical board availability when a symbol is not
            # entitled to real-time quotes, while keeping the source Twelve Data.
            for symbol in symbols:
                try:
                    result = await self.get_candles(symbol, Timeframe.D1, 2)
                except TwelveDataError:
                    continue
                latest = result.candles[-1] if result.candles else None
                previous = result.candles[-2] if len(result.candles) > 1 else None
                if latest:
                    items.append({
                        "symbol": symbol,
                        "name": TWELVE_ASSET_NAMES.get(symbol, symbol),
                        "asset_class": TWELVE_ASSET_CLASSES[symbol],
                        "price": latest.close,
                        "change_percent": ((latest.close / previous.close) - 1) * 100
                        if previous and previous.close > 0
                        else None,
                        "timestamp": latest.timestamp,
                        "volume": latest.volume,
                        "provider": "twelve_data",
                        "provider_symbol": TWELVE_SYMBOLS[symbol],
                    })
        self._board_cache[cache_key] = (time.monotonic(), items)
        return items

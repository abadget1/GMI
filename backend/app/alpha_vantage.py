from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from math import isfinite
from typing import Any, Mapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx

from .config import Settings
from .domain import Candle, Timeframe, primitive


class AlphaAssetClass(str, Enum):
    INDEX = "index"
    FOREX = "forex"
    CRYPTO = "crypto"
    COMMODITY = "commodity"


@dataclass(frozen=True, slots=True)
class AlphaAssetSpec:
    symbol: str
    name: str
    asset_class: AlphaAssetClass
    provider_symbol: str
    quote_symbol: str | None = None
    proxy_symbol: str | None = None
    currency: str = "USD"

    def public_contract(self) -> dict[str, Any]:
        basis = "direct"
        if self.asset_class is AlphaAssetClass.INDEX and self.proxy_symbol:
            basis = f"direct daily index / {self.proxy_symbol} intraday proxy"
        elif self.asset_class is AlphaAssetClass.COMMODITY:
            basis = "official close-only commodity series"
        return {
            "symbol": self.symbol,
            "name": self.name,
            "asset_class": self.asset_class,
            "provider": "alpha_vantage",
            "provider_symbol": self.provider_symbol,
            "currency": self.currency,
            "price_basis": basis,
            "supported_timeframes": [item.value for item in Timeframe],
        }


ALPHA_ASSETS: tuple[AlphaAssetSpec, ...] = (
    AlphaAssetSpec("SPX", "S&P 500", AlphaAssetClass.INDEX, "SPX", proxy_symbol="SPY"),
    AlphaAssetSpec("NDX", "Nasdaq 100", AlphaAssetClass.INDEX, "NDX", proxy_symbol="QQQ"),
    AlphaAssetSpec("DJI", "Dow Jones Industrial Average", AlphaAssetClass.INDEX, "DJI", proxy_symbol="DIA"),
    AlphaAssetSpec("EURUSD", "Euro / US Dollar", AlphaAssetClass.FOREX, "EUR", quote_symbol="USD"),
    AlphaAssetSpec("GBPUSD", "British Pound / US Dollar", AlphaAssetClass.FOREX, "GBP", quote_symbol="USD"),
    AlphaAssetSpec("USDJPY", "US Dollar / Japanese Yen", AlphaAssetClass.FOREX, "USD", quote_symbol="JPY", currency="JPY"),
    AlphaAssetSpec("BTCUSD", "Bitcoin / US Dollar", AlphaAssetClass.CRYPTO, "BTC", quote_symbol="USD"),
    AlphaAssetSpec("ETHUSD", "Ethereum / US Dollar", AlphaAssetClass.CRYPTO, "ETH", quote_symbol="USD"),
    AlphaAssetSpec("SOLUSD", "Solana / US Dollar", AlphaAssetClass.CRYPTO, "SOL", quote_symbol="USD"),
    AlphaAssetSpec("WTI", "WTI Crude Oil", AlphaAssetClass.COMMODITY, "WTI"),
    AlphaAssetSpec("BRENT", "Brent Crude Oil", AlphaAssetClass.COMMODITY, "BRENT"),
    AlphaAssetSpec("NATURAL_GAS", "Natural Gas", AlphaAssetClass.COMMODITY, "NATURAL_GAS"),
)

ALPHA_ASSET_BY_SYMBOL = {asset.symbol: asset for asset in ALPHA_ASSETS}


class AlphaVantageError(RuntimeError):
    pass


class AlphaVantageNotConfigured(AlphaVantageError):
    pass


class AlphaVantageEntitlementError(AlphaVantageError):
    pass


class AlphaVantageRateLimitError(AlphaVantageError):
    pass


@dataclass(frozen=True, slots=True)
class AlphaSeriesResult:
    symbol: str
    requested_timeframe: Timeframe
    effective_timeframe: Timeframe
    candles: tuple[Candle, ...]
    source_function: str
    price_basis: str
    fetched_at: datetime
    fallback_reason: str | None = None

    def metadata(self) -> dict[str, Any]:
        return primitive(
            {
                "provider": "alpha_vantage",
                "source_function": self.source_function,
                "requested_timeframe": self.requested_timeframe,
                "effective_timeframe": self.effective_timeframe,
                "price_basis": self.price_basis,
                "fetched_at": self.fetched_at,
                "fallback_reason": self.fallback_reason,
            }
        )


def _finite_number(value: Any) -> float | None:
    try:
        parsed = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return parsed if isfinite(parsed) else None


def _field(row: Mapping[str, Any], name: str, quote: str | None = None) -> float | None:
    candidates = [
        (key, value)
        for key, value in row.items()
        if name in str(key).casefold()
    ]
    if quote:
        quoted = [item for item in candidates if f"({quote.casefold()})" in str(item[0]).casefold()]
        if quoted:
            candidates = quoted
    for _, value in candidates:
        parsed = _finite_number(value)
        if parsed is not None:
            return parsed
    return None


def _payload_timezone(payload: Mapping[str, Any]):
    metadata = payload.get("Meta Data")
    if isinstance(metadata, Mapping):
        for key, value in metadata.items():
            if "time zone" not in str(key).casefold() or not isinstance(value, str):
                continue
            try:
                return ZoneInfo(value)
            except ZoneInfoNotFoundError:
                break
    return timezone.utc


def _parse_timestamp(value: Any, source_timezone) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=source_timezone)
    return parsed.astimezone(timezone.utc)


def _series_mapping(payload: Mapping[str, Any]) -> Mapping[str, Any] | None:
    for key, value in payload.items():
        if "time series" in str(key).casefold() and isinstance(value, Mapping):
            return value
    return None


def parse_alpha_ohlcv(
    payload: Mapping[str, Any],
    *,
    symbol: str,
    timeframe: Timeframe,
    quote: str | None = None,
) -> list[Candle]:
    """Normalize Alpha Vantage time-series or list payloads into Candle objects."""

    source_timezone = _payload_timezone(payload)
    series = _series_mapping(payload)
    records: list[tuple[Any, Mapping[str, Any]]] = []
    if series is not None:
        records = [(timestamp, row) for timestamp, row in series.items() if isinstance(row, Mapping)]
    else:
        data = payload.get("data")
        if isinstance(data, list):
            records = [
                (row.get("date") or row.get("timestamp") or row.get("time"), row)
                for row in data
                if isinstance(row, Mapping)
            ]

    candles: list[Candle] = []
    for timestamp_value, row in records:
        timestamp = _parse_timestamp(timestamp_value, source_timezone)
        if timestamp is None:
            continue
        close = _field(row, "close", quote)
        if close is None:
            close = _field(row, "value", quote)
        if close is None or close <= 0:
            continue
        opening = _field(row, "open", quote)
        opening = close if opening is None else opening
        high = _field(row, "high", quote)
        high = max(opening, close) if high is None else high
        low = _field(row, "low", quote)
        low = min(opening, close) if low is None else low
        volume = _field(row, "volume", quote) or 0.0
        try:
            candles.append(
                Candle(
                    symbol=symbol,
                    timeframe=timeframe,
                    timestamp=timestamp,
                    open=opening,
                    high=high,
                    low=low,
                    close=close,
                    volume=max(0.0, volume),
                )
            )
        except ValueError:
            continue
    candles.sort(key=lambda candle: candle.timestamp)
    return candles


def _bucket_timestamp(value: datetime, timeframe: Timeframe) -> datetime:
    epoch = int(value.timestamp())
    return datetime.fromtimestamp(epoch - epoch % timeframe.seconds, tz=timezone.utc)


def resample_alpha_candles(candles: list[Candle], timeframe: Timeframe) -> list[Candle]:
    if not candles or candles[0].timeframe is timeframe:
        return candles
    if timeframe.seconds < candles[0].timeframe.seconds:
        return candles
    buckets: dict[datetime, list[Candle]] = {}
    for candle in candles:
        buckets.setdefault(_bucket_timestamp(candle.timestamp, timeframe), []).append(candle)
    return [
        Candle(
            symbol=values[0].symbol,
            timeframe=timeframe,
            timestamp=timestamp,
            open=values[0].open,
            high=max(item.high for item in values),
            low=min(item.low for item in values),
            close=values[-1].close,
            volume=sum(item.volume for item in values),
        )
        for timestamp, values in sorted(buckets.items())
    ]


class AlphaVantageClient:
    """Quota-aware Alpha Vantage adapter with premium-to-daily fallback."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = settings.alpha_vantage_api_key
        self.base_url = settings.alpha_vantage_base_url
        self.cache_ttl_seconds = settings.alpha_vantage_cache_ttl_seconds
        self.min_request_interval_seconds = (
            settings.alpha_vantage_min_request_interval_seconds
        )
        self.intraday_enabled = settings.alpha_vantage_intraday_enabled
        self._client = httpx.AsyncClient(
            timeout=settings.alpha_vantage_timeout_seconds,
            transport=transport,
            headers={"User-Agent": "Meridian-GMI/1.0"},
        )
        self._cache: dict[tuple[str, Timeframe], tuple[float, AlphaSeriesResult]] = {}
        self._response_cache: dict[
            tuple[tuple[str, str], ...], tuple[float, Mapping[str, Any]]
        ] = {}
        self._locks: dict[tuple[str, Timeframe], asyncio.Lock] = {}
        self._request_lock = asyncio.Lock()
        self._last_request_started = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def close(self) -> None:
        await self._client.aclose()

    async def _paced_get(self, params: dict[str, str]) -> httpx.Response:
        async with self._request_lock:
            elapsed = time.monotonic() - self._last_request_started
            remaining = self.min_request_interval_seconds - elapsed
            if remaining > 0:
                await asyncio.sleep(remaining)
            self._last_request_started = time.monotonic()
            return await self._client.get(
                self.base_url,
                params={**params, "apikey": self.api_key},
            )

    async def _request(self, params: dict[str, str]) -> Mapping[str, Any]:
        if not self.api_key:
            raise AlphaVantageNotConfigured(
                "Set GMI_ALPHA_VANTAGE_API_KEY to enable Alpha Vantage market data."
            )
        request_key = tuple(sorted(params.items()))
        cached = self._response_cache.get(request_key)
        now = time.monotonic()
        if cached and now - cached[0] < self.cache_ttl_seconds:
            return cached[1]
        for attempt in range(2):
            response = await self._paced_get(params)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, Mapping):
                raise AlphaVantageError("Alpha Vantage returned a non-object response")
            message = next(
                (
                    value
                    for key in ("Error Message", "Note", "Information")
                    if isinstance((value := payload.get(key)), str)
                ),
                None,
            )
            if message is None:
                self._response_cache[request_key] = (time.monotonic(), payload)
                return payload
            lowered = message.casefold()
            is_rate_limit = any(
                marker in lowered
                for marker in (
                    "rate limit",
                    "call frequency",
                    "requests per",
                    "request per second",
                    "spread out",
                )
            )
            if is_rate_limit:
                if attempt == 0:
                    continue
                raise AlphaVantageRateLimitError(message)
            if "premium" in lowered or "subscribe" in lowered or "entitlement" in lowered:
                raise AlphaVantageEntitlementError(message)
            raise AlphaVantageError(message)
        raise AlphaVantageError("Alpha Vantage request failed")

    async def get_candles(self, symbol: str, timeframe: Timeframe) -> AlphaSeriesResult:
        normalized = symbol.upper()
        cache_key = (normalized, timeframe)
        cached = self._cache.get(cache_key)
        now = time.monotonic()
        if cached and now - cached[0] < self.cache_ttl_seconds:
            return cached[1]
        lock = self._locks.setdefault(cache_key, asyncio.Lock())
        async with lock:
            cached = self._cache.get(cache_key)
            now = time.monotonic()
            if cached and now - cached[0] < self.cache_ttl_seconds:
                return cached[1]
            if normalized == "GMI":
                result = await self._global_composite(timeframe)
            else:
                asset = ALPHA_ASSET_BY_SYMBOL.get(normalized)
                if asset is None:
                    raise AlphaVantageError(f"{normalized} is not in the Alpha Vantage asset catalog")
                result = await self._fetch_asset(asset, timeframe)
            self._cache[cache_key] = (time.monotonic(), result)
            return result

    async def _fetch_asset(self, asset: AlphaAssetSpec, requested: Timeframe) -> AlphaSeriesResult:
        fallback_reason: str | None = None
        if asset.asset_class is AlphaAssetClass.COMMODITY:
            payload = await self._request(
                {"function": asset.provider_symbol, "interval": "daily", "datatype": "json"}
            )
            candles = parse_alpha_ohlcv(payload, symbol=asset.symbol, timeframe=Timeframe.D1)
            return self._result(
                asset,
                requested,
                Timeframe.D1,
                candles,
                asset.provider_symbol,
                "official close-only commodity series",
                None if requested is Timeframe.D1 else "Alpha Vantage commodity history is daily-only.",
            )

        if requested is not Timeframe.D1 and self.intraday_enabled:
            try:
                return await self._fetch_intraday(asset, requested)
            except AlphaVantageEntitlementError:
                fallback_reason = "Intraday entitlement unavailable; using Alpha Vantage daily data."
        elif requested is not Timeframe.D1:
            fallback_reason = "Intraday requests are disabled; using Alpha Vantage daily data."

        if asset.asset_class is AlphaAssetClass.INDEX:
            try:
                payload = await self._request(
                    {
                        "function": "INDEX_DATA",
                        "symbol": asset.provider_symbol,
                        "interval": "daily",
                        "datatype": "json",
                    }
                )
                candles = parse_alpha_ohlcv(payload, symbol=asset.symbol, timeframe=Timeframe.D1)
                return self._result(
                    asset, requested, Timeframe.D1, candles, "INDEX_DATA", "direct index", fallback_reason
                )
            except AlphaVantageEntitlementError:
                fallback_reason = (
                    (fallback_reason + " " if fallback_reason else "")
                    + f"Direct index entitlement unavailable; using {asset.proxy_symbol} ETF proxy."
                )
                return await self._fetch_equity_daily(asset, requested, fallback_reason)

        params = {"outputsize": "compact", "datatype": "json"}
        if asset.asset_class is AlphaAssetClass.FOREX:
            params.update(
                {
                    "function": "FX_DAILY",
                    "from_symbol": asset.provider_symbol,
                    "to_symbol": asset.quote_symbol or "USD",
                }
            )
            source_function = "FX_DAILY"
        else:
            params.update(
                {
                    "function": "DIGITAL_CURRENCY_DAILY",
                    "symbol": asset.provider_symbol,
                    "market": asset.quote_symbol or "USD",
                }
            )
            source_function = "DIGITAL_CURRENCY_DAILY"
        payload = await self._request(params)
        candles = parse_alpha_ohlcv(
            payload,
            symbol=asset.symbol,
            timeframe=Timeframe.D1,
            quote=asset.quote_symbol,
        )
        return self._result(
            asset, requested, Timeframe.D1, candles, source_function, "direct", fallback_reason
        )

    async def _fetch_equity_daily(
        self,
        asset: AlphaAssetSpec,
        requested: Timeframe,
        fallback_reason: str,
    ) -> AlphaSeriesResult:
        payload = await self._request(
            {
                "function": "TIME_SERIES_DAILY",
                "symbol": asset.proxy_symbol or asset.provider_symbol,
                "outputsize": "compact",
                "datatype": "json",
            }
        )
        candles = parse_alpha_ohlcv(payload, symbol=asset.symbol, timeframe=Timeframe.D1)
        return self._result(
            asset,
            requested,
            Timeframe.D1,
            candles,
            "TIME_SERIES_DAILY",
            f"{asset.proxy_symbol} ETF proxy",
            fallback_reason,
        )

    async def _fetch_intraday(
        self,
        asset: AlphaAssetSpec,
        requested: Timeframe,
    ) -> AlphaSeriesResult:
        native = Timeframe.H1 if requested is Timeframe.H4 else requested
        interval = {
            Timeframe.M15: "15min",
            Timeframe.M30: "30min",
            Timeframe.H1: "60min",
            Timeframe.H4: "60min",
        }[requested]
        params = {"interval": interval, "outputsize": "compact", "datatype": "json"}
        quote: str | None = None
        price_basis = "direct"
        if asset.asset_class is AlphaAssetClass.INDEX:
            params.update(
                {
                    "function": "TIME_SERIES_INTRADAY",
                    "symbol": asset.proxy_symbol or asset.provider_symbol,
                    "extended_hours": "false",
                }
            )
            source_function = "TIME_SERIES_INTRADAY"
            price_basis = f"{asset.proxy_symbol} ETF proxy"
        elif asset.asset_class is AlphaAssetClass.FOREX:
            params.update(
                {
                    "function": "FX_INTRADAY",
                    "from_symbol": asset.provider_symbol,
                    "to_symbol": asset.quote_symbol or "USD",
                }
            )
            source_function = "FX_INTRADAY"
            quote = asset.quote_symbol
        else:
            params.update(
                {
                    "function": "CRYPTO_INTRADAY",
                    "symbol": asset.provider_symbol,
                    "market": asset.quote_symbol or "USD",
                }
            )
            source_function = "CRYPTO_INTRADAY"
            quote = asset.quote_symbol
        payload = await self._request(params)
        candles = parse_alpha_ohlcv(payload, symbol=asset.symbol, timeframe=native, quote=quote)
        if requested is Timeframe.H4:
            candles = resample_alpha_candles(candles, Timeframe.H4)
        return self._result(
            asset, requested, requested, candles, source_function, price_basis, None
        )

    async def _global_composite(self, requested: Timeframe) -> AlphaSeriesResult:
        spx, ndx = await asyncio.gather(
            self.get_candles("SPX", requested),
            self.get_candles("NDX", requested),
        )
        effective = (
            requested
            if spx.effective_timeframe is requested and ndx.effective_timeframe is requested
            else Timeframe.D1
        )
        spx_by_time = {item.timestamp: item for item in spx.candles}
        ndx_by_time = {item.timestamp: item for item in ndx.candles}
        timestamps = sorted(set(spx_by_time) & set(ndx_by_time))
        if not timestamps:
            raise AlphaVantageError("SPX and NDX series do not have aligned timestamps")
        spx_reference = spx_by_time[timestamps[0]].close
        ndx_reference = ndx_by_time[timestamps[0]].close
        candles = tuple(
            Candle(
                symbol="GMI",
                timeframe=effective,
                timestamp=timestamp,
                open=500 * spx_by_time[timestamp].open / spx_reference
                + 500 * ndx_by_time[timestamp].open / ndx_reference,
                high=500 * spx_by_time[timestamp].high / spx_reference
                + 500 * ndx_by_time[timestamp].high / ndx_reference,
                low=500 * spx_by_time[timestamp].low / spx_reference
                + 500 * ndx_by_time[timestamp].low / ndx_reference,
                close=500 * spx_by_time[timestamp].close / spx_reference
                + 500 * ndx_by_time[timestamp].close / ndx_reference,
                volume=spx_by_time[timestamp].volume + ndx_by_time[timestamp].volume,
            )
            for timestamp in timestamps
        )
        reasons = " ".join(
            reason for reason in (spx.fallback_reason, ndx.fallback_reason) if reason
        ) or None
        return AlphaSeriesResult(
            symbol="GMI",
            requested_timeframe=requested,
            effective_timeframe=effective,
            candles=candles,
            source_function=f"{spx.source_function}+{ndx.source_function}",
            price_basis="50/50 normalized SPX and NDX",
            fetched_at=datetime.now(timezone.utc),
            fallback_reason=reasons,
        )

    @staticmethod
    def _result(
        asset: AlphaAssetSpec,
        requested: Timeframe,
        effective: Timeframe,
        candles: list[Candle],
        source_function: str,
        price_basis: str,
        fallback_reason: str | None,
    ) -> AlphaSeriesResult:
        if not candles:
            raise AlphaVantageError(
                f"Alpha Vantage {source_function} response contained no usable candles for {asset.symbol}"
            )
        return AlphaSeriesResult(
            symbol=asset.symbol,
            requested_timeframe=requested,
            effective_timeframe=effective,
            candles=tuple(candles),
            source_function=source_function,
            price_basis=price_basis,
            fetched_at=datetime.now(timezone.utc),
            fallback_reason=fallback_reason,
        )

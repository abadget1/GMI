from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import date, datetime, timezone
from math import isfinite
from typing import Any, Mapping
from urllib.parse import quote

import httpx

from .config import Settings
from .domain import Candle, Timeframe, primitive


@dataclass(frozen=True, slots=True)
class MassiveAssetSpec:
    symbol: str
    name: str
    asset_class: str
    product_code: str
    currency: str = "USD"

    def public_contract(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "name": self.name,
            "asset_class": self.asset_class,
            "provider": "massive",
            "provider_symbol": self.product_code,
            "currency": self.currency,
            "price_basis": "active front-month futures contract from Massive",
            "supported_timeframes": [item.value for item in Timeframe],
        }


MASSIVE_ASSETS: tuple[MassiveAssetSpec, ...] = (
    MassiveAssetSpec("RTY", "Russell 2000 E-mini", "index", "RTY"),
    MassiveAssetSpec("ES", "S&P 500 E-mini", "index", "ES"),
    MassiveAssetSpec("NQ", "Nasdaq-100 E-mini", "index", "NQ"),
    MassiveAssetSpec("YM", "Dow Jones E-mini", "index", "YM"),
    MassiveAssetSpec("NKD", "Nikkei 225 E-mini", "index", "NKD"),
    MassiveAssetSpec("RB", "RBOB Gasoline", "commodity", "RB"),
    MassiveAssetSpec("CL", "WTI Crude Oil", "commodity", "CL"),
    MassiveAssetSpec("QM", "E-mini Crude Oil", "commodity", "QM"),
    MassiveAssetSpec("HO", "Heating Oil", "commodity", "HO"),
    MassiveAssetSpec("NG", "Natural Gas", "commodity", "NG"),
    MassiveAssetSpec("QG", "E-mini Natural Gas", "commodity", "QG"),
    MassiveAssetSpec("GC", "Gold", "commodity", "GC"),
    MassiveAssetSpec("SI", "Silver", "commodity", "SI"),
    MassiveAssetSpec("HG", "Copper", "commodity", "HG"),
)

MASSIVE_ASSET_BY_SYMBOL = {asset.symbol: asset for asset in MASSIVE_ASSETS}
MASSIVE_PUBLIC_SYMBOLS = tuple(MASSIVE_ASSET_BY_SYMBOL)
MASSIVE_SYMBOL_ALIASES = {
    **{f"{symbol}1!": symbol for symbol in MASSIVE_PUBLIC_SYMBOLS},
}


def canonical_symbol(value: str) -> str:
    normalized = value.strip().upper()
    return MASSIVE_SYMBOL_ALIASES.get(normalized, normalized)


class MassiveError(RuntimeError):
    pass


class MassiveNotConfiguredError(MassiveError):
    pass


class MassiveEntitlementError(MassiveError):
    pass


class MassiveRateLimitError(MassiveError):
    pass


@dataclass(frozen=True, slots=True)
class MassiveSeriesResult:
    symbol: str
    requested_timeframe: Timeframe
    effective_timeframe: Timeframe
    candles: tuple[Candle, ...]
    provider_symbol: str
    fetched_at: datetime

    def metadata(self) -> dict[str, Any]:
        return primitive(
            {
                "provider": "massive",
                "provider_symbol": self.provider_symbol,
                "requested_timeframe": self.requested_timeframe,
                "effective_timeframe": self.effective_timeframe,
                "fetched_at": self.fetched_at,
                "price_basis": "active front-month futures contract",
            }
        )


def _resolution(timeframe: Timeframe) -> str:
    return {
        Timeframe.M15: "15min",
        Timeframe.M30: "30min",
        Timeframe.H1: "1hour",
        Timeframe.H4: "4hour",
        Timeframe.D1: "1session",
    }[timeframe]


def _number(value: Any) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if isfinite(parsed) else None


def _nanoseconds_timestamp(value: Any) -> datetime | None:
    parsed = _number(value)
    if parsed is None or parsed < 0:
        return None
    try:
        return datetime.fromtimestamp(parsed / 1_000_000_000, tz=timezone.utc)
    except (OSError, OverflowError, ValueError):
        return None


class MassiveClient:
    """Cached adapter for Massive's futures contracts and aggregate bars APIs."""

    def __init__(
        self,
        settings: Settings,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.api_key = settings.massive_api_key
        self.base_url = settings.massive_base_url.rstrip("/")
        self.cache_ttl_seconds = settings.massive_cache_ttl_seconds
        self.contract_cache_ttl_seconds = settings.massive_contract_cache_ttl_seconds
        self.history_limit = settings.history_limit
        self.min_request_interval_seconds = settings.massive_min_request_interval_seconds
        self._client = httpx.AsyncClient(
            timeout=settings.massive_timeout_seconds,
            transport=transport,
            headers={"User-Agent": "Meridian-GMI/1.0"},
        )
        self._cache: dict[tuple[str, Timeframe], tuple[float, MassiveSeriesResult]] = {}
        self._stale_cache: dict[tuple[str, Timeframe], MassiveSeriesResult] = {}
        self._contract_cache: dict[str, tuple[float, str]] = {}
        self._board_cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._request_lock = asyncio.Lock()
        self._series_locks: dict[tuple[str, Timeframe], asyncio.Lock] = {}
        self._contract_locks: dict[str, asyncio.Lock] = {}
        self._board_locks: dict[str, asyncio.Lock] = {}
        self._last_request_started = 0.0

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    async def close(self) -> None:
        await self._client.aclose()

    async def _get(self, endpoint: str, params: Mapping[str, str]) -> Mapping[str, Any]:
        if not self.api_key:
            raise MassiveNotConfiguredError("Massive is not configured")
        async with self._request_lock:
            elapsed = time.monotonic() - self._last_request_started
            if elapsed < self.min_request_interval_seconds:
                await asyncio.sleep(self.min_request_interval_seconds - elapsed)
            self._last_request_started = time.monotonic()
            try:
                response = await self._client.get(
                    f"{self.base_url}/{endpoint.lstrip('/')}",
                    params={**params, "apiKey": self.api_key},
                )
            except httpx.HTTPError as exc:
                raise MassiveError(f"Massive request failed: {exc}") from exc
        try:
            payload = response.json()
        except ValueError as exc:
            if response.status_code == 429:
                raise MassiveRateLimitError("Massive rate limit reached") from exc
            raise MassiveError(
                f"Massive returned HTTP {response.status_code} with an invalid response"
            ) from exc
        message = ""
        if isinstance(payload, Mapping):
            message = str(
                payload.get("error")
                or payload.get("message")
                or payload.get("status")
                or ""
            )
        if response.status_code == 429:
            raise MassiveRateLimitError(message or "Massive rate limit reached")
        if response.status_code in {401, 403}:
            raise MassiveEntitlementError(
                message or f"Massive returned HTTP {response.status_code}"
            )
        if response.status_code >= 400:
            raise MassiveError(message or f"Massive returned HTTP {response.status_code}")
        if not isinstance(payload, Mapping):
            raise MassiveError("Massive returned an invalid response")
        if str(payload.get("status", "OK")).upper() not in {"OK", "DELAYED"}:
            raise MassiveError(message or "Massive returned a provider error")
        return payload

    async def resolve_contract(self, symbol: str) -> str:
        normalized = canonical_symbol(symbol)
        asset = MASSIVE_ASSET_BY_SYMBOL.get(normalized)
        if asset is None:
            raise MassiveError(f"Unsupported Massive futures symbol: {normalized}")
        lock = self._contract_locks.setdefault(normalized, asyncio.Lock())
        async with lock:
            cached = self._contract_cache.get(normalized)
            if cached and time.monotonic() - cached[0] < self.contract_cache_ttl_seconds:
                return cached[1]
            today = date.today().isoformat()
            payload = await self._get(
                "futures/v1/contracts",
                {
                    "product_code": asset.product_code,
                    "active": "true",
                    "date": today,
                    "last_trade_date.gt": today,
                    "type": "single",
                    "limit": "100",
                    "sort": "ticker.asc",
                },
            )
            rows = payload.get("results")
            candidates = (
                [
                    row
                    for row in rows
                    if isinstance(row, Mapping)
                    and str(row.get("product_code", "")).upper()
                    == asset.product_code
                    and row.get("ticker")
                ]
                if isinstance(rows, list)
                else []
            )
            if not candidates:
                raise MassiveError(f"Massive returned no active contract for {normalized}")
            candidates.sort(
                key=lambda row: str(row.get("last_trade_date") or "9999-12-31")
            )
            ticker = str(candidates[0]["ticker"]).upper()
            self._contract_cache[normalized] = (time.monotonic(), ticker)
            return ticker

    async def _get_symbol_candles(
        self, symbol: str, timeframe: Timeframe, limit: int
    ) -> MassiveSeriesResult:
        normalized = canonical_symbol(symbol)
        ticker = await self.resolve_contract(normalized)
        payload = await self._get(
            f"futures/v1/aggs/{quote(ticker, safe='')}",
            {
                "resolution": _resolution(timeframe),
                "limit": str(max(1, min(50_000, limit))),
                "sort": "window_start.desc",
            },
        )
        rows = payload.get("results")
        candles: list[Candle] = []
        if isinstance(rows, list):
            for row in rows:
                if not isinstance(row, Mapping):
                    continue
                timestamp = _nanoseconds_timestamp(row.get("window_start"))
                numbers = [
                    _number(row.get(key)) for key in ("open", "high", "low", "close")
                ]
                volume = _number(row.get("volume")) or 0.0
                if (
                    timestamp is None
                    or any(value is None for value in numbers)
                    or volume < 0
                ):
                    continue
                try:
                    candles.append(
                        Candle(
                            symbol=normalized,
                            timeframe=timeframe,
                            timestamp=timestamp,
                            open=numbers[0],
                            high=numbers[1],
                            low=numbers[2],
                            close=numbers[3],
                            volume=volume,
                        )
                    )
                except (TypeError, ValueError):
                    continue
        candles.sort(key=lambda item: item.timestamp)
        if not candles:
            raise MassiveError(f"Massive returned no aggregate bars for {ticker}")
        return MassiveSeriesResult(
            symbol=normalized,
            requested_timeframe=timeframe,
            effective_timeframe=timeframe,
            candles=tuple(candles[-limit:]),
            provider_symbol=ticker,
            fetched_at=datetime.now(timezone.utc),
        )

    async def _get_gmi(
        self, timeframe: Timeframe, limit: int
    ) -> MassiveSeriesResult:
        es, nq = await asyncio.gather(
            self.get_candles("ES", timeframe, limit),
            self.get_candles("NQ", timeframe, limit),
        )
        es_by_time = {item.timestamp: item for item in es.candles}
        nq_by_time = {item.timestamp: item for item in nq.candles}
        shared = sorted(es_by_time.keys() & nq_by_time.keys())
        if not shared:
            raise MassiveError("ES and NQ series have no aligned Massive timestamps")
        es_base = es_by_time[shared[0]].close
        nq_base = nq_by_time[shared[0]].close
        candles = tuple(
            Candle(
                symbol="GMI",
                timeframe=timeframe,
                timestamp=timestamp,
                open=500
                * (
                    es_by_time[timestamp].open / es_base
                    + nq_by_time[timestamp].open / nq_base
                ),
                high=500
                * (
                    es_by_time[timestamp].high / es_base
                    + nq_by_time[timestamp].high / nq_base
                ),
                low=500
                * (
                    es_by_time[timestamp].low / es_base
                    + nq_by_time[timestamp].low / nq_base
                ),
                close=500
                * (
                    es_by_time[timestamp].close / es_base
                    + nq_by_time[timestamp].close / nq_base
                ),
                volume=es_by_time[timestamp].volume + nq_by_time[timestamp].volume,
            )
            for timestamp in shared[-limit:]
        )
        return MassiveSeriesResult(
            symbol="GMI",
            requested_timeframe=timeframe,
            effective_timeframe=timeframe,
            candles=candles,
            provider_symbol=f"{es.provider_symbol}+{nq.provider_symbol}",
            fetched_at=datetime.now(timezone.utc),
        )

    async def get_candles(
        self, symbol: str, timeframe: Timeframe, limit: int = 500
    ) -> MassiveSeriesResult:
        normalized = canonical_symbol(symbol)
        bounded_limit = max(1, min(50_000, int(limit)))
        fetch_limit = max(bounded_limit, self.history_limit)
        key = (normalized, timeframe)
        lock = self._series_locks.setdefault(key, asyncio.Lock())
        async with lock:
            cached = self._cache.get(key)
            if cached and time.monotonic() - cached[0] < self.cache_ttl_seconds:
                return cached[1]
            try:
                result = (
                    await self._get_gmi(timeframe, fetch_limit)
                    if normalized == "GMI"
                    else await self._get_symbol_candles(
                        normalized, timeframe, fetch_limit
                    )
                )
            except MassiveError:
                stale = self._stale_cache.get(key)
                if stale is not None:
                    return stale
                raise
            self._cache[key] = (time.monotonic(), result)
            self._stale_cache[key] = result
            return result

    async def get_board(
        self, asset_class: str | None = None, limit: int = 8
    ) -> list[dict[str, Any]]:
        bounded_limit = max(1, min(len(MASSIVE_ASSETS), int(limit)))
        cache_key = f"{asset_class or '*'}:{bounded_limit}"
        lock = self._board_locks.setdefault(cache_key, asyncio.Lock())
        async with lock:
            cached = self._board_cache.get(cache_key)
            if cached and time.monotonic() - cached[0] < min(
                30.0, self.cache_ttl_seconds
            ):
                return cached[1]
            assets = [
                asset
                for asset in MASSIVE_ASSETS
                if asset_class is None or asset.asset_class == asset_class.casefold()
            ]
            assets.sort(key=lambda asset: (asset.symbol not in {"ES", "NQ"},))
            assets = assets[:bounded_limit]
            items: list[dict[str, Any]] = []
            # Keep requests sequential so a low-rate plan cannot let a board
            # fan-out starve the selected chart's higher-priority history call.
            for asset in assets:
                try:
                    result = await self.get_candles(asset.symbol, Timeframe.D1, 2)
                except MassiveError:
                    continue
                if not result.candles:
                    continue
                latest = result.candles[-1]
                previous = result.candles[-2] if len(result.candles) > 1 else None
                change = (
                    ((latest.close / previous.close) - 1) * 100
                    if previous is not None and previous.close > 0
                    else None
                )
                items.append(
                    {
                        "symbol": asset.symbol,
                        "name": asset.name,
                        "asset_class": asset.asset_class,
                        "price": latest.close,
                        "change_percent": change,
                        "timestamp": latest.timestamp,
                        "volume": latest.volume,
                        "provider": "massive",
                        "provider_symbol": result.provider_symbol,
                    }
                )
            self._board_cache[cache_key] = (time.monotonic(), items)
            return items

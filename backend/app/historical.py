from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from math import isfinite
from typing import Any, Iterable, Mapping

from .domain import Candle, Timeframe


class HistoricalDataError(ValueError):
    """A client-readable historical import validation error."""


@dataclass(frozen=True, slots=True)
class ParsedHistoricalData:
    candles: tuple[Candle, ...]
    source_format: str
    rows_received: int
    rows_deduplicated: int


_FIELD_ALIASES = {
    "timestamp": ("timestamp", "time", "datetime", "date"),
    "open": ("open", "o"),
    "high": ("high", "h"),
    "low": ("low", "l"),
    "close": ("close", "c", "last"),
    "volume": ("volume", "vol", "v"),
}


def _clean_key(value: object) -> str:
    return str(value).strip().casefold().replace("_", "").replace(" ", "")


def _lookup(row: Mapping[str, Any], field: str, *, required: bool) -> Any:
    normalized = {_clean_key(key): value for key, value in row.items()}
    for alias in _FIELD_ALIASES[field]:
        value = normalized.get(_clean_key(alias))
        if value is not None and str(value).strip() != "":
            return value
    if required:
        aliases = ", ".join(_FIELD_ALIASES[field])
        raise HistoricalDataError(f"missing required {field} column (accepted: {aliases})")
    return 0.0


def _number(value: Any, field: str, row_number: int) -> float:
    try:
        parsed = float(str(value).replace(",", "").strip())
    except (TypeError, ValueError) as exc:
        raise HistoricalDataError(f"row {row_number}: {field} must be a number") from exc
    if not isfinite(parsed):
        raise HistoricalDataError(f"row {row_number}: {field} must be finite")
    return parsed


def _timestamp(value: Any, row_number: int) -> datetime:
    if isinstance(value, (int, float)) or (isinstance(value, str) and value.strip().replace(".", "", 1).isdigit()):
        numeric = float(value)
        if not isfinite(numeric):
            raise HistoricalDataError(f"row {row_number}: timestamp must be finite")
        if abs(numeric) > 100_000_000_000:
            numeric /= 1_000
        try:
            return datetime.fromtimestamp(numeric, tz=timezone.utc)
        except (OverflowError, OSError, ValueError) as exc:
            raise HistoricalDataError(f"row {row_number}: invalid timestamp") from exc
    try:
        parsed = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError as exc:
        raise HistoricalDataError(
            f"row {row_number}: timestamp must be ISO-8601 or Unix seconds/milliseconds"
        ) from exc
    return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)


def _records_from_csv(body: str) -> Iterable[Mapping[str, Any]]:
    reader = csv.DictReader(io.StringIO(body))
    if not reader.fieldnames:
        raise HistoricalDataError("CSV requires a header row")
    return (row for row in reader if any(str(value).strip() for value in row.values() if value is not None))


def _records_from_json(body: str) -> Iterable[Mapping[str, Any]]:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HistoricalDataError(f"invalid JSON: {exc.msg}") from exc
    if isinstance(payload, dict):
        payload = payload.get("candles", payload.get("data"))
    if not isinstance(payload, list):
        raise HistoricalDataError("JSON must be an array of OHLCV rows or an object with a candles array")
    if not all(isinstance(item, dict) for item in payload):
        raise HistoricalDataError("every JSON candle row must be an object")
    return payload


def parse_historical_data(
    body: bytes,
    *,
    symbol: str,
    timeframe: Timeframe,
    source_format: str = "auto",
    max_rows: int = 10_000,
) -> ParsedHistoricalData:
    """Parse and normalize a CSV or JSON OHLCV upload into validated candles.

    A timestamp may be ISO-8601, Unix seconds, or Unix milliseconds. Duplicate
    timestamps are resolved last-row-wins so vendor corrections can be imported
    without a separate pre-processing pass.
    """

    if not body:
        raise HistoricalDataError("the uploaded file is empty")
    try:
        text = body.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HistoricalDataError("the upload must be UTF-8 encoded CSV or JSON") from exc

    normalized_format = source_format.casefold()
    if normalized_format not in {"auto", "csv", "json"}:
        raise HistoricalDataError("format must be auto, csv, or json")
    if normalized_format == "auto":
        normalized_format = "json" if text.lstrip().startswith(("[", "{")) else "csv"
    records = _records_from_json(text) if normalized_format == "json" else _records_from_csv(text)

    rows_received = 0
    candles_by_timestamp: dict[datetime, Candle] = {}
    for row_number, row in enumerate(records, start=2 if normalized_format == "csv" else 1):
        rows_received += 1
        if rows_received > max_rows:
            raise HistoricalDataError(f"upload exceeds the {max_rows:,}-row limit")
        try:
            candle = Candle(
                symbol=symbol,
                timeframe=timeframe,
                timestamp=_timestamp(_lookup(row, "timestamp", required=True), row_number),
                open=_number(_lookup(row, "open", required=True), "open", row_number),
                high=_number(_lookup(row, "high", required=True), "high", row_number),
                low=_number(_lookup(row, "low", required=True), "low", row_number),
                close=_number(_lookup(row, "close", required=True), "close", row_number),
                volume=_number(_lookup(row, "volume", required=False), "volume", row_number),
            )
        except HistoricalDataError:
            raise
        except ValueError as exc:
            raise HistoricalDataError(f"row {row_number}: {exc}") from exc
        candles_by_timestamp[candle.timestamp] = candle

    if not candles_by_timestamp:
        raise HistoricalDataError("no candle rows were found")
    candles = tuple(candles_by_timestamp[key] for key in sorted(candles_by_timestamp))
    return ParsedHistoricalData(
        candles=candles,
        source_format=normalized_format,
        rows_received=rows_received,
        rows_deduplicated=rows_received - len(candles),
    )

// Node's strip-types test runner requires an explicit TypeScript extension.
// @ts-expect-error TS5097: the application bundler and Node both resolve this source file.
import { detectSupplyDemandZones } from "./zones.ts";
import type {
  MarketStreamCandle,
  MarketStreamZone,
} from "./market-stream-adapter.js";
import type { MarketTimeframe, ZoneDetectionOptions } from "./types.js";

export const MAX_CLIENT_HISTORICAL_ROWS = 10_000;

export type ClientHistoricalFormat = "csv" | "json";

export interface ClientHistoricalImportInput {
  text: string;
  format: ClientHistoricalFormat;
  symbol: string;
  timeframe: MarketTimeframe | string;
}

export class ClientHistoricalImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientHistoricalImportError";
  }
}

type HistoricalField = "timestamp" | "open" | "high" | "low" | "close" | "volume";
type UnknownRecord = Record<string, unknown>;

const FIELD_ALIASES: Readonly<Record<HistoricalField, readonly string[]>> = {
  timestamp: ["timestamp", "time", "datetime", "date"],
  open: ["open", "o"],
  high: ["high", "h"],
  low: ["low", "l"],
  close: ["close", "c", "last"],
  volume: ["volume", "vol", "v"],
};

const MARKET_TIMEFRAMES = new Set<MarketTimeframe>(["15m", "30m", "1h", "4h", "1d"]);
const SYMBOL_PATTERN = /^[A-Z0-9._:/-]{1,32}$/;
const DECIMAL_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const NUMERIC_TIMESTAMP_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(?:([Zz])|([+-])(\d{2}):?(\d{2}))?)?$/;

function fail(message: string): never {
  throw new ClientHistoricalImportError(message);
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanKey(value: string): string {
  return value.trim().toLowerCase().replace(/[_\s]/g, "");
}

function normalizeSymbol(value: string): string {
  const symbol = value.trim().toUpperCase();
  if (!SYMBOL_PATTERN.test(symbol)) {
    fail("symbol must contain 1-32 letters, numbers, ., _, :, /, or -");
  }
  return symbol;
}

function normalizeTimeframe(value: string): MarketTimeframe {
  const timeframe = value.trim().toLowerCase() as MarketTimeframe;
  if (!MARKET_TIMEFRAMES.has(timeframe)) {
    fail(`unsupported market timeframe: ${value}`);
  }
  return timeframe;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }

  if (quoted) fail("CSV contains an unterminated quoted field");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function recordsFromCsv(text: string): UnknownRecord[] {
  const rows = parseCsvRows(text);
  const headers = rows[0];
  if (!headers) fail("CSV requires a header row");

  return rows.slice(1)
    .filter((row) => row.some((value) => value.trim() !== ""))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function recordsFromJson(text: string): UnknownRecord[] {
  let payload: unknown;
  try {
    payload = JSON.parse(text) as unknown;
  } catch (error) {
    const detail = error instanceof SyntaxError ? error.message : "invalid JSON";
    fail(`invalid JSON: ${detail}`);
  }

  if (isRecord(payload)) {
    payload = Object.prototype.hasOwnProperty.call(payload, "candles")
      ? payload.candles
      : payload.data;
  }
  if (!Array.isArray(payload)) {
    fail("JSON must be an array of OHLCV rows or an object with a candles array");
  }
  if (!payload.every(isRecord)) {
    fail("every JSON candle row must be an object");
  }
  return payload;
}

function lookup(row: UnknownRecord, field: HistoricalField, required: boolean): unknown {
  const normalized = new Map(
    Object.entries(row).map(([key, value]) => [cleanKey(key), value]),
  );
  for (const alias of FIELD_ALIASES[field]) {
    const value = normalized.get(cleanKey(alias));
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  if (required) {
    fail(`missing required ${field} column (accepted: ${FIELD_ALIASES[field].join(", ")})`);
  }
  return 0;
}

function finiteNumber(value: unknown, field: HistoricalField, rowNumber: number): number {
  const normalized = typeof value === "string" ? value.replace(/,/g, "").trim() : value;
  const parsed = typeof normalized === "number"
    ? normalized
    : typeof normalized === "string" && DECIMAL_NUMBER_PATTERN.test(normalized)
      ? Number(normalized)
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    fail(`row ${rowNumber}: ${field} must be a finite number`);
  }
  return parsed;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isoTimestampMs(value: string, rowNumber: number): number {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (!match) {
    fail(`row ${rowNumber}: timestamp must be ISO-8601 or Unix seconds/milliseconds`);
  }

  const [, rawYear, rawMonth, rawDay, rawHour, rawMinute, rawSecond, rawFraction, zulu, offsetSign, rawOffsetHour, rawOffsetMinute] = match;
  const year = Number(rawYear);
  const month = Number(rawMonth);
  const day = Number(rawDay);
  const hour = Number(rawHour ?? 0);
  const minute = Number(rawMinute ?? 0);
  const second = Number(rawSecond ?? 0);
  const offsetHour = Number(rawOffsetHour ?? 0);
  const offsetMinute = Number(rawOffsetMinute ?? 0);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    fail(`row ${rowNumber}: invalid timestamp`);
  }

  const fraction = rawFraction ? `.${rawFraction.slice(0, 3).padEnd(3, "0")}` : "";
  const zone = zulu
    ? "Z"
    : offsetSign
      ? `${offsetSign}${String(offsetHour).padStart(2, "0")}:${String(offsetMinute).padStart(2, "0")}`
      : "Z";
  const normalized = `${rawYear}-${rawMonth}-${rawDay}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}${fraction}${zone}`;
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) fail(`row ${rowNumber}: invalid timestamp`);
  return timestamp;
}

function timestampMs(value: unknown, rowNumber: number): number {
  const stringValue = typeof value === "string" ? value.trim() : undefined;
  const numeric = typeof value === "number"
    ? value
    : stringValue && NUMERIC_TIMESTAMP_PATTERN.test(stringValue)
      ? Number(stringValue)
      : undefined;
  if (numeric !== undefined) {
    if (!Number.isFinite(numeric)) fail(`row ${rowNumber}: timestamp must be finite`);
    const timestamp = Math.abs(numeric) > 100_000_000_000 ? numeric : numeric * 1_000;
    if (!Number.isFinite(new Date(timestamp).getTime())) fail(`row ${rowNumber}: invalid timestamp`);
    return timestamp;
  }
  if (stringValue) return isoTimestampMs(stringValue, rowNumber);
  fail(`row ${rowNumber}: timestamp must be ISO-8601 or Unix seconds/milliseconds`);
}

/** Parse a browser-selected CSV/JSON upload using the same OHLCV contract as FastAPI. */
export function parseClientHistoricalImport(
  input: ClientHistoricalImportInput,
): MarketStreamCandle[] {
  const symbol = normalizeSymbol(input.symbol);
  const timeframe = normalizeTimeframe(input.timeframe);
  if (input.format !== "csv" && input.format !== "json") {
    fail("format must be csv or json");
  }

  const text = input.text.charCodeAt(0) === 0xfeff ? input.text.slice(1) : input.text;
  if (text.length === 0) fail("the uploaded file is empty");
  const rows = input.format === "json" ? recordsFromJson(text) : recordsFromCsv(text);
  const candlesByTimestamp = new Map<number, MarketStreamCandle>();

  rows.forEach((row, index) => {
    const rowNumber = index + (input.format === "csv" ? 2 : 1);
    if (index >= MAX_CLIENT_HISTORICAL_ROWS) {
      fail(`upload exceeds the ${MAX_CLIENT_HISTORICAL_ROWS.toLocaleString("en-US")}-row limit`);
    }
    const time = timestampMs(lookup(row, "timestamp", true), rowNumber);
    const open = finiteNumber(lookup(row, "open", true), "open", rowNumber);
    const high = finiteNumber(lookup(row, "high", true), "high", rowNumber);
    const low = finiteNumber(lookup(row, "low", true), "low", rowNumber);
    const close = finiteNumber(lookup(row, "close", true), "close", rowNumber);
    const volume = finiteNumber(lookup(row, "volume", false), "volume", rowNumber);

    if ([open, high, low, close].some((value) => value <= 0)) {
      fail(`row ${rowNumber}: candle prices must be finite and positive`);
    }
    if (volume < 0) fail(`row ${rowNumber}: candle volume must be finite and non-negative`);
    if (low > high || low > Math.min(open, close) || high < Math.max(open, close)) {
      fail(`row ${rowNumber}: OHLC values are inconsistent`);
    }

    candlesByTimestamp.set(time, {
      symbol,
      timeframe,
      time,
      open,
      high,
      low,
      close,
      volume,
    });
  });

  if (candlesByTimestamp.size === 0) fail("no candle rows were found");
  return Array.from(candlesByTimestamp.values()).sort((left, right) => left.time - right.time);
}

/** Derive chart-ready zones from locally parsed candles without a backend round trip. */
export function deriveClientHistoricalZones(
  candles: readonly MarketStreamCandle[],
  options: Omit<ZoneDetectionOptions, "timeframe"> = {},
): MarketStreamZone[] {
  if (candles.length === 0) return [];
  const { symbol, timeframe } = candles[0];
  if (candles.some((candle) => candle.symbol !== symbol || candle.timeframe !== timeframe)) {
    fail("all candles must share one symbol and timeframe before deriving zones");
  }

  return detectSupplyDemandZones(candles, { ...options, timeframe })
    .filter((zone) => zone.quality.freshness !== "invalidated")
    .map((zone) => ({
      id: zone.id,
      symbol,
      timeframe,
      side: zone.side,
      lower: zone.lower,
      upper: zone.upper,
      proximal: zone.proximal,
      distal: zone.distal,
      baseTimestamp: zone.createdAt,
      impulseStart: candles[zone.impulseStartIndex]?.time ?? zone.createdAt,
      impulseEnd: candles[zone.impulseEndIndex]?.time ?? zone.createdAt,
      impulseCandles: zone.impulseEndIndex - zone.impulseStartIndex + 1,
      qualityScore: zone.quality.score,
      freshness: zone.quality.freshness === "virgin" ? "virgin" : "tested",
      testCount: zone.quality.testCount,
      trendAligned: zone.quality.trendAligned,
      fairValueGap: zone.quality.fairValueGap,
      breakOfStructure: zone.quality.breakOfStructure,
      rationale: zone.structuralDescription,
    }));
}

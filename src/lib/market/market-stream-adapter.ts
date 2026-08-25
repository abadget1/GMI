import type { MarketTimeframe, OhlcvBar, TimestampMs, ZoneSide } from "./types.js";

/** Public production backend; local env values still take precedence. */
export const DEFAULT_MARKET_API_URL = "https://gmi-backend.vercel.app/api/v1";

export type MarketTimeframeInput =
  | MarketTimeframe
  | "15M"
  | "30M"
  | "1H"
  | "4H"
  | "1D";

export type MarketFeedSource = "websocket" | "rest" | "upload" | "unavailable";

export interface MarketStreamCandle extends OhlcvBar {
  symbol: string;
  timeframe: MarketTimeframe;
}

export interface MarketStreamZone {
  id: string;
  symbol: string;
  timeframe: MarketTimeframe;
  side: ZoneSide;
  lower: number;
  upper: number;
  proximal: number;
  distal: number;
  /** Exact structural x-coordinate of the opposing base candle. */
  baseTimestamp: TimestampMs;
  /** Exact structural x-coordinate of the first impulse candle. */
  impulseStart: TimestampMs;
  /** Exact structural x-coordinate of the final impulse candle. */
  impulseEnd: TimestampMs;
  impulseCandles: number;
  qualityScore: number;
  freshness: "virgin" | "tested";
  testCount: number;
  trendAligned: boolean;
  fairValueGap: boolean;
  breakOfStructure: boolean;
  rationale: string;
}

export type MarketPressureState = "demand" | "supply" | "balanced";

export interface MarketStreamPressure {
  key: string;
  label: string;
  group: string;
  /** Backend convention: -100 supply to +100 demand. */
  score: number;
  state: MarketPressureState;
  confidence: number;
  drivers: Readonly<Record<string, number>>;
}

export type MarketAlertMode = "approach" | "cross" | "inside";

export interface MarketStreamAlert {
  id: string;
  ruleId: string;
  zoneId: string;
  symbol: string;
  timeframe?: MarketTimeframe;
  mode: MarketAlertMode;
  side: ZoneSide;
  price: number;
  distancePercent: number;
  thresholdPercent: number;
  triggeredAt: TimestampMs;
  message: string;
}

export interface NormalizedMarketSnapshot {
  sequence: number;
  generatedAt: TimestampMs | null;
  prices: Readonly<Record<string, number>>;
  changesPercent: Readonly<Record<string, number>>;
  volumes: Readonly<Record<string, number>>;
  composite: Readonly<Partial<Record<MarketTimeframe, MarketStreamCandle>>>;
  pressure: readonly MarketStreamPressure[];
  zones: Readonly<Record<string, readonly MarketStreamZone[]>>;
  zonesByTimeframe: Readonly<
    Partial<
      Record<
        MarketTimeframe,
        Readonly<Record<string, readonly MarketStreamZone[]>>
      >
    >
  >;
  alerts: readonly MarketStreamAlert[];
}

export interface SelectedMarketSnapshot {
  symbol: string;
  timeframe: MarketTimeframe;
  currentValue?: number;
  changePercent?: number;
  volume?: number;
  liveCandle?: MarketStreamCandle;
  pressure: readonly MarketStreamPressure[];
  zones: readonly MarketStreamZone[];
  /** True when the frame explicitly publishes this symbol/timeframe, even if empty. */
  zonesAreAuthoritative: boolean;
  alerts: readonly MarketStreamAlert[];
}

export interface MarketEndpointInput {
  /** API host or full `/api/v1` prefix. `null` explicitly disables REST. */
  apiUrl?: string | null;
  /** WS host or full `/ws/market` endpoint. `null` explicitly disables WS. */
  wsUrl?: string | null;
}

export interface MarketEndpoints {
  apiBaseUrl?: string;
  wsUrl?: string;
}

export interface MarketRestUrls {
  snapshot: string;
  candles: string;
  zones: string;
}

export interface MarketQuoteUpdate {
  symbol: string;
  timeframe: MarketTimeframeInput | string;
  price: number;
  /** Snapshot generation time or local fallback tick time, in epoch milliseconds. */
  generatedAt: TimestampMs;
  volume?: number;
}

export interface MarketZoneFilterOptions {
  includeTestedZones?: boolean;
  minZoneQuality?: number;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function timestampMs(value: unknown): TimestampMs | undefined {
  const numeric = finiteNumber(value);
  if (numeric !== undefined) {
    const milliseconds = Math.abs(numeric) < 100_000_000_000 ? numeric * 1_000 : numeric;
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }
  if (typeof value !== "string") return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function removeTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function toHttpProtocol(value: string): string {
  return value.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
}

function toWebSocketProtocol(value: string): string {
  return value.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

export function normalizeMarketTimeframe(value: MarketTimeframeInput | string): MarketTimeframe {
  const normalized = value.trim().toLowerCase();
  if (normalized === "15m" || normalized === "30m" || normalized === "1h" || normalized === "4h" || normalized === "1d") {
    return normalized;
  }
  throw new RangeError(`Unsupported market timeframe: ${value}.`);
}

export function marketTimeframeDurationMs(
  timeframeInput: MarketTimeframeInput | string,
): number {
  const timeframe = normalizeMarketTimeframe(timeframeInput);
  return {
    "15m": 15 * 60 * 1_000,
    "30m": 30 * 60 * 1_000,
    "1h": 60 * 60 * 1_000,
    "4h": 4 * 60 * 60 * 1_000,
    "1d": 24 * 60 * 60 * 1_000,
  }[timeframe];
}

/** Returns the canonical UTC start of the timeframe bucket containing a tick. */
export function marketBucketStart(
  timestamp: TimestampMs,
  timeframeInput: MarketTimeframeInput | string,
): TimestampMs {
  if (!Number.isFinite(timestamp)) throw new RangeError("timestamp must be finite.");
  const duration = marketTimeframeDurationMs(timeframeInput);
  return Math.floor(timestamp / duration) * duration;
}

export function marketBucketAdvanced(
  previousTimestamp: TimestampMs | undefined,
  nextTimestamp: TimestampMs,
  timeframeInput: MarketTimeframeInput | string,
): boolean {
  if (previousTimestamp === undefined) return false;
  return (
    marketBucketStart(nextTimestamp, timeframeInput) >
    marketBucketStart(previousTimestamp, timeframeInput)
  );
}

/** Deterministic capped exponential delay used by the browser reconnect loop. */
export function marketReconnectDelayMs(
  attempt: number,
  baseDelayMs = 750,
  maximumDelayMs = 15_000,
): number {
  if (!Number.isFinite(attempt) || !Number.isFinite(baseDelayMs) || !Number.isFinite(maximumDelayMs)) {
    throw new RangeError("Reconnect delay inputs must be finite.");
  }
  const boundedAttempt = Math.max(0, Math.floor(attempt));
  const base = Math.max(1, baseDelayMs);
  const maximum = Math.max(base, maximumDelayMs);
  return Math.min(maximum, base * 2 ** Math.min(boundedAttempt, 30));
}

export function normalizeMarketSymbol(value: string): string {
  const normalized = value.trim().toUpperCase();
  const aliases: Readonly<Record<string, string>> = {
    "^GSPC": "SPY",
    SPX: "SPY",
    "S&P500": "SPY",
    "S&P 500": "SPY",
    SP500: "SPY",
    "^IXIC": "QQQ",
    IXIC: "QQQ",
    NASDAQ: "QQQ",
    NDX: "QQQ",
    "^DJI": "DIA",
    DJI: "DIA",
  };
  return aliases[normalized] ?? normalized;
}

/**
 * Formats a provider symbol for human-facing labels without changing the
 * canonical symbol used for Twelve Data requests and stream subscriptions.
 */
export function formatMarketSymbolForDisplay(value: string): string {
  return normalizeMarketSymbol(value).replace(/1!$/, "");
}

function normalizeApiUrl(value: string): string | undefined {
  let normalized = removeTrailingSlash(toHttpProtocol(value.trim()));
  if (!normalized) return undefined;
  normalized = normalized.replace(/\/ws\/market$/i, "");
  if (/\/api\/v\d+$/i.test(normalized)) return normalized;
  if (/\/api$/i.test(normalized)) return `${normalized}/v1`;
  return `${normalized}/api/v1`;
}

function normalizeWsUrl(value: string): string | undefined {
  let normalized = removeTrailingSlash(toWebSocketProtocol(value.trim()));
  if (!normalized) return undefined;
  normalized = normalized.replace(/\/api\/v\d+$/i, "");
  if (/\/ws\/market$/i.test(normalized)) return normalized;

  // A URL with no path is a host; append the backend's canonical WS route.
  const schemeIndex = normalized.indexOf("://");
  const pathIndex = schemeIndex >= 0 ? normalized.indexOf("/", schemeIndex + 3) : normalized.indexOf("/");
  return pathIndex < 0 ? `${normalized}/ws/market` : normalized;
}

/** Resolves either endpoint from the other while respecting explicit `null` disables. */
export function resolveMarketEndpoints(input: MarketEndpointInput = {}): MarketEndpoints {
  const apiDisabled = input.apiUrl === null;
  const wsDisabled = input.wsUrl === null;
  const directApi = typeof input.apiUrl === "string" ? normalizeApiUrl(input.apiUrl) : undefined;
  const directWs = typeof input.wsUrl === "string" ? normalizeWsUrl(input.wsUrl) : undefined;
  const apiBaseUrl = apiDisabled ? undefined : directApi ?? (directWs ? normalizeApiUrl(directWs) : undefined);
  const wsUrl = wsDisabled ? undefined : directWs ?? (directApi ? normalizeWsUrl(directApi) : undefined);
  return { apiBaseUrl, wsUrl };
}

export function buildMarketRestUrls(
  apiBaseUrl: string,
  symbolInput: string,
  timeframeInput: MarketTimeframeInput | string,
  options: { candleLimit?: number; includeTestedZones?: boolean; minZoneQuality?: number } = {},
): MarketRestUrls {
  const symbol = normalizeMarketSymbol(symbolInput);
  const timeframe = normalizeMarketTimeframe(timeframeInput);
  const candleLimit = Math.min(500, Math.max(1, Math.round(options.candleLimit ?? 120)));
  const minQuality = Math.min(100, Math.max(0, options.minZoneQuality ?? 0));
  const includeTested = options.includeTestedZones ?? true;
  const base = removeTrailingSlash(apiBaseUrl);
  const symbolQuery = encodeURIComponent(symbol);
  const timeframeQuery = encodeURIComponent(timeframe);
  return {
    snapshot: `${base}/snapshot`,
    candles: `${base}/index/candles?symbol=${symbolQuery}&timeframe=${timeframeQuery}&limit=${candleLimit}`,
    zones: `${base}/zones/${symbolQuery}?timeframe=${timeframeQuery}&include_tested=${includeTested}&min_quality=${minQuality}`,
  };
}

function adaptCandle(
  value: unknown,
  fallbackSymbol: string,
  fallbackTimeframe: MarketTimeframe,
): MarketStreamCandle | undefined {
  if (!isRecord(value)) return undefined;
  const time = timestampMs(value.timestamp ?? value.time);
  const open = finiteNumber(value.open);
  const high = finiteNumber(value.high);
  const low = finiteNumber(value.low);
  const close = finiteNumber(value.close);
  const volume = finiteNumber(value.volume) ?? 0;
  if (
    time === undefined ||
    open === undefined ||
    high === undefined ||
    low === undefined ||
    close === undefined ||
    open <= 0 ||
    high < Math.max(open, close) ||
    low > Math.min(open, close) ||
    volume < 0
  ) {
    return undefined;
  }
  let timeframe = fallbackTimeframe;
  try {
    timeframe = normalizeMarketTimeframe(stringValue(value.timeframe) ?? fallbackTimeframe);
  } catch {
    return undefined;
  }
  return {
    symbol: normalizeMarketSymbol(stringValue(value.symbol) ?? fallbackSymbol),
    timeframe,
    time,
    open,
    high,
    low,
    close,
    volume,
  };
}

function adaptZone(
  value: unknown,
  fallbackSymbol: string,
  fallbackTimeframe: MarketTimeframe,
): MarketStreamZone | undefined {
  if (!isRecord(value)) return undefined;
  const side = stringValue(value.side);
  if (side !== "supply" && side !== "demand") return undefined;
  const lower = finiteNumber(value.lower);
  const upper = finiteNumber(value.upper);
  const proximal = finiteNumber(value.proximal);
  const distal = finiteNumber(value.distal);
  const baseTimestamp = timestampMs(value.base_timestamp ?? value.baseTimestamp);
  const impulseStart = timestampMs(value.impulse_start ?? value.impulseStart);
  const impulseEnd = timestampMs(value.impulse_end ?? value.impulseEnd);
  if (
    lower === undefined ||
    upper === undefined ||
    proximal === undefined ||
    distal === undefined ||
    baseTimestamp === undefined ||
    impulseStart === undefined ||
    impulseEnd === undefined ||
    lower > upper
  ) {
    return undefined;
  }
  let timeframe = fallbackTimeframe;
  try {
    timeframe = normalizeMarketTimeframe(stringValue(value.timeframe) ?? fallbackTimeframe);
  } catch {
    return undefined;
  }
  const testCount = Math.max(0, Math.round(finiteNumber(value.touch_count ?? value.testCount) ?? 0));
  const virgin = booleanValue(value.virgin, testCount === 0);
  return {
    id: stringValue(value.id) ?? `${fallbackSymbol}-${side}-${baseTimestamp}`,
    symbol: normalizeMarketSymbol(stringValue(value.symbol) ?? fallbackSymbol),
    timeframe,
    side,
    lower,
    upper,
    proximal,
    distal,
    baseTimestamp,
    impulseStart,
    impulseEnd,
    impulseCandles: Math.max(0, Math.round(finiteNumber(value.impulse_candles ?? value.impulseCandles) ?? 0)),
    qualityScore: Math.min(100, Math.max(0, finiteNumber(value.quality_score ?? value.qualityScore) ?? 0)),
    freshness: virgin ? "virgin" : "tested",
    testCount,
    trendAligned: booleanValue(value.trend_aligned ?? value.trendAligned),
    fairValueGap: booleanValue(value.fair_value_gap ?? value.fairValueGap),
    breakOfStructure: booleanValue(value.break_of_structure ?? value.breakOfStructure),
    rationale: stringValue(value.rationale) ?? "Rule-based impulsive departure zone",
  };
}

function adaptPressure(value: unknown): MarketStreamPressure | undefined {
  if (!isRecord(value)) return undefined;
  const key = stringValue(value.key);
  const label = stringValue(value.label);
  const group = stringValue(value.group);
  const rawScore = finiteNumber(value.score);
  if (!key || !label || !group || rawScore === undefined) return undefined;
  const score = Math.min(100, Math.max(-100, rawScore));
  const rawState = stringValue(value.state);
  const state: MarketPressureState =
    rawState === "demand" || rawState === "supply" || rawState === "balanced"
      ? rawState
      : score >= 20
        ? "demand"
        : score <= -20
          ? "supply"
          : "balanced";
  const drivers: Record<string, number> = {};
  if (isRecord(value.drivers)) {
    Object.entries(value.drivers).forEach(([driver, rawValue]) => {
      const normalized = finiteNumber(rawValue);
      if (normalized !== undefined) drivers[driver] = normalized;
    });
  }
  return {
    key,
    label,
    group,
    score,
    state,
    confidence: Math.min(1, Math.max(0, finiteNumber(value.confidence) ?? 0)),
    drivers,
  };
}

function adaptAlert(value: unknown): MarketStreamAlert | undefined {
  if (!isRecord(value)) return undefined;
  const mode = stringValue(value.mode);
  const side = stringValue(value.side);
  const triggeredAt = timestampMs(value.triggered_at ?? value.triggeredAt);
  const price = finiteNumber(value.price);
  if (
    (mode !== "approach" && mode !== "cross" && mode !== "inside") ||
    (side !== "supply" && side !== "demand") ||
    triggeredAt === undefined ||
    price === undefined
  ) {
    return undefined;
  }
  let timeframe: MarketTimeframe | undefined;
  const rawTimeframe = stringValue(value.timeframe);
  if (rawTimeframe) {
    try {
      timeframe = normalizeMarketTimeframe(rawTimeframe);
    } catch {
      timeframe = undefined;
    }
  }
  return {
    id: stringValue(value.id) ?? `${stringValue(value.zone_id) ?? "zone"}-${triggeredAt}`,
    ruleId: stringValue(value.rule_id ?? value.ruleId) ?? "",
    zoneId: stringValue(value.zone_id ?? value.zoneId) ?? "",
    symbol: normalizeMarketSymbol(stringValue(value.symbol) ?? "GMI"),
    timeframe,
    mode,
    side,
    price,
    distancePercent: Math.max(0, finiteNumber(value.distance_pct ?? value.distancePercent) ?? 0),
    thresholdPercent: Math.max(
      0,
      finiteNumber(value.threshold_pct ?? value.thresholdPercent) ?? 0,
    ),
    triggeredAt,
    message: stringValue(value.message) ?? "Market zone alert triggered.",
  };
}

function numericMap(value: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (!isRecord(value)) return result;
  Object.entries(value).forEach(([key, rawValue]) => {
    const normalized = finiteNumber(rawValue);
    if (normalized !== undefined) result[normalizeMarketSymbol(key)] = normalized;
  });
  return result;
}

export function adaptCandleResponse(
  payload: unknown,
  symbolInput: string,
  timeframeInput: MarketTimeframeInput | string,
): MarketStreamCandle[] {
  const symbol = normalizeMarketSymbol(symbolInput);
  const timeframe = normalizeMarketTimeframe(timeframeInput);
  if (!isRecord(payload) || !Array.isArray(payload.candles)) return [];
  return payload.candles
    .map((value) => adaptCandle(value, symbol, timeframe))
    .filter((value): value is MarketStreamCandle => value !== undefined)
    // The endpoint path/query is authoritative. Prevent a malformed row-level
    // symbol from leaking another asset into the selected chart.
    .map((candle) => ({ ...candle, symbol }))
    .sort((left, right) => left.time - right.time);
}

export function adaptZoneResponse(
  payload: unknown,
  symbolInput: string,
  timeframeInput: MarketTimeframeInput | string,
): MarketStreamZone[] {
  const symbol = normalizeMarketSymbol(symbolInput);
  const timeframe = normalizeMarketTimeframe(timeframeInput);
  if (!isRecord(payload) || !Array.isArray(payload.zones)) return [];
  return payload.zones
    .map((value) => adaptZone(value, symbol, timeframe))
    .filter((value): value is MarketStreamZone => value !== undefined)
    .map((zone) => ({ ...zone, symbol }));
}

/** Accepts either a raw snapshot or the `{type,data}` WebSocket envelope. */
export function adaptMarketSnapshot(payload: unknown): NormalizedMarketSnapshot | undefined {
  if (!isRecord(payload)) return undefined;
  const candidate = isRecord(payload.data) ? payload.data : payload;
  const prices = numericMap(candidate.prices);
  const changesPercent = numericMap(candidate.changes_pct ?? candidate.changesPercent);
  const volumes = numericMap(candidate.volumes);
  if (Object.keys(prices).length === 0 && !Array.isArray(candidate.pressure)) return undefined;

  const composite: Partial<Record<MarketTimeframe, MarketStreamCandle>> = {};
  if (isRecord(candidate.composite)) {
    Object.entries(candidate.composite).forEach(([rawTimeframe, rawCandle]) => {
      try {
        const timeframe = normalizeMarketTimeframe(rawTimeframe);
        const candle = adaptCandle(rawCandle, "GMI", timeframe);
        if (candle) composite[timeframe] = candle;
      } catch {
        // Ignore future/unknown backend timeframe keys.
      }
    });
  }

  const pressure = Array.isArray(candidate.pressure)
    ? candidate.pressure.map(adaptPressure).filter((value): value is MarketStreamPressure => value !== undefined)
    : [];
  const zones: Record<string, readonly MarketStreamZone[]> = {};
  if (isRecord(candidate.zones)) {
    Object.entries(candidate.zones).forEach(([rawSymbol, rawZones]) => {
      if (!Array.isArray(rawZones)) return;
      const symbol = normalizeMarketSymbol(rawSymbol);
      zones[symbol] = rawZones
        .map((value) => adaptZone(value, symbol, "15m"))
        .filter((value): value is MarketStreamZone => value !== undefined);
    });
  }
  const zonesByTimeframe: Partial<
    Record<MarketTimeframe, Readonly<Record<string, readonly MarketStreamZone[]>>>
  > = {};
  const rawZonesByTimeframe = candidate.zones_by_timeframe ?? candidate.zonesByTimeframe;
  if (isRecord(rawZonesByTimeframe)) {
    Object.entries(rawZonesByTimeframe).forEach(([rawTimeframe, rawSymbolMap]) => {
      if (!isRecord(rawSymbolMap)) return;
      try {
        const timeframe = normalizeMarketTimeframe(rawTimeframe);
        const symbolMap: Record<string, readonly MarketStreamZone[]> = {};
        Object.entries(rawSymbolMap).forEach(([rawSymbol, rawZones]) => {
          if (!Array.isArray(rawZones)) return;
          const symbol = normalizeMarketSymbol(rawSymbol);
          symbolMap[symbol] = rawZones
            .map((value) => adaptZone(value, symbol, timeframe))
            .filter((value): value is MarketStreamZone => value !== undefined);
        });
        zonesByTimeframe[timeframe] = symbolMap;
      } catch {
        // Ignore future/unknown backend timeframe keys.
      }
    });
  }
  const alerts = Array.isArray(candidate.alerts)
    ? candidate.alerts.map(adaptAlert).filter((value): value is MarketStreamAlert => value !== undefined)
    : [];

  return {
    sequence: Math.max(0, Math.round(finiteNumber(candidate.sequence) ?? 0)),
    generatedAt: timestampMs(candidate.generated_at ?? candidate.generatedAt) ?? null,
    prices,
    changesPercent,
    volumes,
    composite,
    pressure,
    zones,
    zonesByTimeframe,
    alerts,
  };
}

export function selectMarketSnapshot(
  snapshot: NormalizedMarketSnapshot,
  symbolInput: string,
  timeframeInput: MarketTimeframeInput | string,
): SelectedMarketSnapshot {
  const symbol = normalizeMarketSymbol(symbolInput);
  const timeframe = normalizeMarketTimeframe(timeframeInput);
  const liveCandle = symbol === "GMI" ? snapshot.composite[timeframe] : undefined;
  const timeframeZones = snapshot.zonesByTimeframe[timeframe]?.[symbol];
  const legacyZones = timeframe === "15m" ? snapshot.zones[symbol] : undefined;
  return {
    symbol,
    timeframe,
    currentValue: snapshot.prices[symbol] ?? liveCandle?.close,
    changePercent: snapshot.changesPercent[symbol],
    volume: snapshot.volumes[symbol],
    liveCandle,
    pressure: snapshot.pressure,
    zones: (timeframeZones ?? legacyZones ?? []).filter(
      (zone) => zone.timeframe === timeframe,
    ),
    zonesAreAuthoritative: timeframeZones !== undefined || legacyZones !== undefined,
    alerts: snapshot.alerts.filter(
      (alert) => alert.symbol === symbol && (!alert.timeframe || alert.timeframe === timeframe),
    ),
  };
}

/** Maintains a bounded, newest-first event log across transient snapshot frames. */
export function mergeMarketAlerts(
  current: readonly MarketStreamAlert[],
  incoming: readonly MarketStreamAlert[],
  limit = 20,
): MarketStreamAlert[] {
  const boundedLimit = Math.max(1, Math.round(limit));
  const byId = new Map<string, MarketStreamAlert>();
  current.forEach((alert) => byId.set(alert.id, alert));
  incoming.forEach((alert) => byId.set(alert.id, alert));
  return Array.from(byId.values())
    .sort((left, right) => right.triggeredAt - left.triggeredAt)
    .slice(0, boundedLimit);
}

export function filterMarketZones(
  zones: readonly MarketStreamZone[],
  options: MarketZoneFilterOptions = {},
): MarketStreamZone[] {
  const includeTested = options.includeTestedZones ?? true;
  const minimumQuality = Math.min(100, Math.max(0, options.minZoneQuality ?? 0));
  return zones.filter(
    (zone) =>
      zone.qualityScore >= minimumQuality &&
      (includeTested || zone.freshness === "virgin"),
  );
}

/** Rolls a quote into its canonical bucket while preserving candle OHLC semantics. */
export function mergeMarketQuoteIntoCandles(
  candles: readonly MarketStreamCandle[],
  update: MarketQuoteUpdate,
  limit = 120,
): readonly MarketStreamCandle[] {
  if (!Number.isFinite(update.price) || update.price <= 0) return candles;
  const symbol = normalizeMarketSymbol(update.symbol);
  const timeframe = normalizeMarketTimeframe(update.timeframe);
  const bucketTime = marketBucketStart(update.generatedAt, timeframe);
  const boundedLimit = Math.max(1, Math.round(limit));
  const last = candles[candles.length - 1];

  if (!last || bucketTime > last.time) {
    const openingTick: MarketStreamCandle = {
      symbol,
      timeframe,
      time: bucketTime,
      open: update.price,
      high: update.price,
      low: update.price,
      close: update.price,
      volume: 0,
      ...(update.volume !== undefined ? { volume: update.volume } : {}),
    };
    return [...candles, openingTick].slice(-boundedLimit);
  }
  if (bucketTime < last.time || last.symbol !== symbol || last.timeframe !== timeframe) {
    return candles;
  }
  if (last.close === update.price && update.volume === undefined) return candles;
  return [
    ...candles.slice(0, -1),
    {
      ...last,
      high: Math.max(last.high, update.price),
      low: Math.min(last.low, update.price),
      close: update.price,
      ...(update.volume !== undefined
        ? { volume: Math.max(last.volume ?? 0, update.volume) }
        : {}),
    },
  ];
}

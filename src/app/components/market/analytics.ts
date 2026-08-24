import type {
  ActivityRegion,
  Candle,
  ChartTimeframe,
  HeatmapMetric,
  IndexAssetOption,
  PriceZone,
  WatchlistAsset,
} from "./types";

export interface MarketAnalyticsPoint {
  time: string;
  timestamp?: number;
  close: number;
  returnPercent: number;
  cumulativeReturnPercent: number;
  drawdownPercent: number;
  volume?: number;
}

export interface MarketAnalyticsSummary {
  timeframe: ChartTimeframe;
  bars: number;
  startValue: number;
  endValue: number;
  change: number;
  changePercent: number;
  high: number;
  low: number;
  rangePercent: number;
  averageVolume: number;
  maxDrawdownPercent: number;
  realizedVolatilityPercent: number;
  bullishRatio: number;
}

export interface MarketAnalyticsResult {
  summary: MarketAnalyticsSummary;
  performance: MarketAnalyticsPoint[];
}

const PERIODS_PER_YEAR: Readonly<Record<ChartTimeframe, number>> = {
  "15m": 252 * 26,
  "30m": 252 * 13,
  "1h": 252 * 6.5,
  "4h": 252 * 1.625,
  "1d": 252,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, precision = 2): number {
  if (!Number.isFinite(value)) return 0;
  const multiplier = 10 ** precision;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function average(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function isUsableCandle(candle: Candle): boolean {
  const prices = [candle.open, candle.high, candle.low, candle.close];
  return (
    prices.every((value) => Number.isFinite(value) && value > 0) &&
    candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) &&
    candle.high >= candle.low
  );
}

function usableCandles(candles: readonly Candle[]): Candle[] {
  return candles.filter(isUsableCandle);
}

function candleTimestamp(candle: Candle): number | undefined {
  if (typeof candle.timestamp === "number" && Number.isFinite(candle.timestamp)) {
    return candle.timestamp;
  }
  const parsed = Date.parse(candle.time);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function percentChange(start: number, end: number): number {
  return start > 0 && Number.isFinite(start) && Number.isFinite(end)
    ? ((end - start) / start) * 100
    : 0;
}

function inferTimeframe(candles: readonly Candle[]): ChartTimeframe {
  const timestamps = candles
    .map(candleTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== undefined);
  const intervals = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index])
    .filter((duration) => duration > 0)
    .sort((left, right) => left - right);
  if (intervals.length === 0) return "1d";
  const median = intervals[Math.floor(intervals.length / 2)];
  if (median <= 22.5 * 60 * 1_000) return "15m";
  if (median <= 45 * 60 * 1_000) return "30m";
  if (median <= 2.5 * 60 * 60 * 1_000) return "1h";
  if (median <= 12 * 60 * 60 * 1_000) return "4h";
  return "1d";
}

export function deriveMarketAnalytics(
  candles: readonly Candle[],
  timeframe: ChartTimeframe,
): MarketAnalyticsResult {
  const bars = usableCandles(candles);
  if (bars.length === 0) {
    return {
      summary: {
        timeframe,
        bars: 0,
        startValue: 0,
        endValue: 0,
        change: 0,
        changePercent: 0,
        high: 0,
        low: 0,
        rangePercent: 0,
        averageVolume: 0,
        maxDrawdownPercent: 0,
        realizedVolatilityPercent: 0,
        bullishRatio: 0,
      },
      performance: [],
    };
  }

  const first = bars[0];
  const last = bars[bars.length - 1];
  let runningPeak = first.close;
  const performance = bars.map<MarketAnalyticsPoint>((candle, index) => {
    runningPeak = Math.max(runningPeak, candle.close);
    return {
      time: candle.time,
      timestamp: candleTimestamp(candle),
      close: candle.close,
      returnPercent: round(index === 0 ? 0 : percentChange(bars[index - 1].close, candle.close), 4),
      cumulativeReturnPercent: round(percentChange(first.close, candle.close), 4),
      drawdownPercent: round(percentChange(runningPeak, candle.close), 4),
      volume: typeof candle.volume === "number" && Number.isFinite(candle.volume)
        ? candle.volume
        : undefined,
    };
  });
  const logReturns = bars.slice(1).map((candle, index) =>
    Math.log(candle.close / bars[index].close),
  );
  const returnMean = average(logReturns);
  const returnVariance = logReturns.length > 1
    ? logReturns.reduce((total, value) => total + (value - returnMean) ** 2, 0) /
      (logReturns.length - 1)
    : 0;
  const high = Math.max(...bars.map((candle) => candle.high));
  const low = Math.min(...bars.map((candle) => candle.low));
  const volumes = bars
    .map((candle) => candle.volume)
    .filter((volume): volume is number => typeof volume === "number" && Number.isFinite(volume) && volume >= 0);
  const worstDrawdown = Math.min(...performance.map((point) => point.drawdownPercent));

  return {
    summary: {
      timeframe,
      bars: bars.length,
      startValue: round(first.close, 6),
      endValue: round(last.close, 6),
      change: round(last.close - first.close, 6),
      changePercent: round(percentChange(first.close, last.close)),
      high: round(high, 6),
      low: round(low, 6),
      rangePercent: round(percentChange(first.close, first.close + (high - low))),
      averageVolume: round(average(volumes)),
      maxDrawdownPercent: round(Math.abs(Math.min(0, worstDrawdown))),
      realizedVolatilityPercent: round(
        Math.sqrt(returnVariance) * Math.sqrt(PERIODS_PER_YEAR[timeframe]) * 100,
      ),
      bullishRatio: round(
        (bars.filter((candle) => candle.close > candle.open).length / bars.length) * 100,
      ),
    },
    performance,
  };
}

function zonePressure(zones: readonly PriceZone[]): number {
  let signedStrength = 0;
  let totalStrength = 0;
  zones.forEach((zone) => {
    if (!Number.isFinite(zone.strength)) return;
    const evidenceMultiplier = 1 + (zone.breakOfStructure ? 0.12 : 0) + (zone.fairValueGap ? 0.08 : 0);
    const strength = clamp(zone.strength, 0, 100) * evidenceMultiplier;
    signedStrength += (zone.type === "demand" ? 1 : -1) * strength;
    totalStrength += strength;
  });
  return totalStrength > 0 ? clamp((signedStrength / totalStrength) * 100, -100, 100) : 0;
}

export function deriveHistoricalHeatmap(
  candles: readonly Candle[],
  zones: readonly PriceZone[],
  symbol: string,
): HeatmapMetric[] {
  const bars = usableCandles(candles);
  if (bars.length === 0) return [];
  const { summary, performance } = deriveMarketAnalytics(bars, inferTimeframe(bars));
  const latest = bars[bars.length - 1];
  const symbolLabel = symbol.trim().toUpperCase() || "DATA";
  const momentumPressure = clamp((summary.changePercent / 5) * 100, -100, 100);
  const trendPressure = clamp((summary.bullishRatio - 50) * 2, -100, 100);
  const structuralPressure = zonePressure(zones);
  const rangePosition = summary.high > summary.low
    ? clamp(((latest.close - summary.low) / (summary.high - summary.low)) * 100, 0, 100)
    : 50;
  const rangePressure = rangePosition * 2 - 100;

  const volumeBars = bars.filter(
    (candle) => typeof candle.volume === "number" && Number.isFinite(candle.volume) && candle.volume >= 0,
  );
  const upVolume = volumeBars.reduce(
    (total, candle) => total + (candle.close >= candle.open ? candle.volume ?? 0 : 0),
    0,
  );
  const downVolume = volumeBars.reduce(
    (total, candle) => total + (candle.close < candle.open ? candle.volume ?? 0 : 0),
    0,
  );
  const totalVolume = upVolume + downVolume;
  const volumePressure = totalVolume > 0 ? ((upVolume - downVolume) / totalVolume) * 100 : 0;
  const recentVolumes = volumeBars.slice(-Math.min(5, volumeBars.length)).map((candle) => candle.volume ?? 0);
  const baselineVolume = average(volumeBars.map((candle) => candle.volume ?? 0));
  const participationChange = baselineVolume > 0
    ? percentChange(baselineVolume, average(recentVolumes))
    : 0;
  const directionalSign = summary.changePercent === 0 ? (trendPressure >= 0 ? 1 : -1) : Math.sign(summary.changePercent);
  const participationPressure = clamp(participationChange * 2 * directionalSign, -100, 100);
  const latestReturn = performance.length > 1
    ? performance[performance.length - 1].returnPercent
    : 0;
  const demandZones = zones.filter((zone) => zone.type === "demand").length;
  const supplyZones = zones.filter((zone) => zone.type === "supply").length;

  return [
    {
      id: `${symbolLabel.toLowerCase()}-return`,
      name: "Period return",
      ticker: symbolLabel,
      group: "Momentum",
      pressure: Math.round(momentumPressure),
      changePercent: summary.changePercent,
      flowLabel: `${summary.bars} synchronized bars`,
    },
    {
      id: `${symbolLabel.toLowerCase()}-trend`,
      name: "Trend persistence",
      ticker: symbolLabel,
      group: "Momentum",
      pressure: Math.round(trendPressure),
      changePercent: latestReturn,
      flowLabel: `${summary.bullishRatio.toFixed(0)}% bullish bars`,
    },
    {
      id: `${symbolLabel.toLowerCase()}-zones`,
      name: "Zone balance",
      ticker: symbolLabel,
      group: "Structure",
      pressure: Math.round(structuralPressure),
      changePercent: summary.changePercent,
      flowLabel: `${demandZones} demand / ${supplyZones} supply`,
    },
    {
      id: `${symbolLabel.toLowerCase()}-range`,
      name: "Range location",
      ticker: symbolLabel,
      group: "Structure",
      pressure: Math.round(rangePressure),
      changePercent: summary.changePercent,
      flowLabel: `${rangePosition.toFixed(0)}% of observed range`,
    },
    {
      id: `${symbolLabel.toLowerCase()}-volume-balance`,
      name: "Volume balance",
      ticker: symbolLabel,
      group: "Flow",
      pressure: Math.round(volumePressure),
      changePercent: summary.changePercent,
      flowLabel: totalVolume > 0 ? `${((upVolume / totalVolume) * 100).toFixed(0)}% up-volume` : "Volume unavailable",
    },
    {
      id: `${symbolLabel.toLowerCase()}-participation`,
      name: "Participation",
      ticker: symbolLabel,
      group: "Flow",
      pressure: Math.round(participationPressure),
      changePercent: round(participationChange),
      flowLabel: totalVolume > 0 ? `Recent volume ${participationChange >= 0 ? "+" : ""}${participationChange.toFixed(0)}%` : "Volume unavailable",
    },
    {
      id: `${symbolLabel.toLowerCase()}-drawdown`,
      name: "Drawdown risk",
      ticker: symbolLabel,
      group: "Risk",
      pressure: -Math.round(clamp(summary.maxDrawdownPercent * 10, 0, 100)),
      changePercent: -summary.maxDrawdownPercent,
      flowLabel: `${summary.maxDrawdownPercent.toFixed(2)}% peak-to-trough`,
    },
    {
      id: `${symbolLabel.toLowerCase()}-volatility`,
      name: "Realized volatility",
      ticker: symbolLabel,
      group: "Risk",
      pressure: -Math.round(clamp(summary.realizedVolatilityPercent * 2.5, 0, 100)),
      changePercent: -summary.realizedVolatilityPercent,
      flowLabel: `${summary.realizedVolatilityPercent.toFixed(2)}% annualized`,
    },
  ];
}

interface ActivitySession {
  id: string;
  city: string;
  exchange: string;
  x: number;
  y: number;
  startMinuteUtc: number;
  endMinuteUtc: number;
}

const ACTIVITY_SESSIONS: readonly ActivitySession[] = [
  { id: "asia", city: "Tokyo", exchange: "Asia session", x: 625, y: 135, startMinuteUtc: 0, endMinuteUtc: 8 * 60 },
  { id: "europe", city: "London", exchange: "Europe session", x: 345, y: 106, startMinuteUtc: 8 * 60, endMinuteUtc: 13 * 60 + 30 },
  { id: "americas", city: "New York", exchange: "Americas session", x: 176, y: 135, startMinuteUtc: 13 * 60 + 30, endMinuteUtc: 21 * 60 },
  { id: "pacific", city: "Sydney", exchange: "Pacific session", x: 625, y: 249, startMinuteUtc: 21 * 60, endMinuteUtc: 24 * 60 },
];

function compactVolume(value: number, bars: number): string {
  if (value <= 0) return `${bars} ${bars === 1 ? "bar" : "bars"}`;
  if (value >= 1_000_000_000) return `${round(value / 1_000_000_000, 1)}B vol`;
  if (value >= 1_000_000) return `${round(value / 1_000_000, 1)}M vol`;
  if (value >= 1_000) return `${round(value / 1_000, 1)}K vol`;
  return `${round(value, 0)} vol`;
}

function minuteOfDayUtc(timestamp: number): number {
  const date = new Date(timestamp);
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

export function deriveActivityRegions(candles: readonly Candle[]): ActivityRegion[] {
  const bars = usableCandles(candles);
  if (bars.length === 0) return [];
  const timestampedBars = bars
    .map((candle) => ({ candle, timestamp: candleTimestamp(candle) }))
    .filter((item): item is { candle: Candle; timestamp: number } => item.timestamp !== undefined);
  const useSessions = timestampedBars.length >= Math.max(1, Math.ceil(bars.length * 0.6));
  const lastTimestamp = timestampedBars.length
    ? timestampedBars[timestampedBars.length - 1].timestamp
    : undefined;
  const activeSessionIndex = lastTimestamp === undefined
    ? -1
    : ACTIVITY_SESSIONS.findIndex((session) => {
        const minute = minuteOfDayUtc(lastTimestamp);
        return minute >= session.startMinuteUtc && minute < session.endMinuteUtc;
      });

  return ACTIVITY_SESSIONS.map((session, index) => {
    const sessionBars = useSessions
      ? timestampedBars
          .filter(({ timestamp }) => {
            const minute = minuteOfDayUtc(timestamp);
            return minute >= session.startMinuteUtc && minute < session.endMinuteUtc;
          })
          .map(({ candle }) => candle)
      : bars.slice(
          Math.floor((index * bars.length) / ACTIVITY_SESSIONS.length),
          Math.floor(((index + 1) * bars.length) / ACTIVITY_SESSIONS.length),
        );
    const first = sessionBars[0];
    const last = sessionBars[sessionBars.length - 1];
    const sessionVolume = sessionBars.reduce(
      (total, candle) => total + (typeof candle.volume === "number" && Number.isFinite(candle.volume) ? candle.volume : 0),
      0,
    );
    const status = index === activeSessionIndex
      ? "open"
      : activeSessionIndex >= 0 && index === (activeSessionIndex + 1) % ACTIVITY_SESSIONS.length
        ? "pre-market"
        : "closed";
    return {
      id: session.id,
      city: session.city,
      exchange: session.exchange,
      x: session.x,
      y: session.y,
      changePercent: first && last ? round(percentChange(first.open, last.close)) : 0,
      status,
      volumeLabel: compactVolume(sessionVolume, sessionBars.length),
    };
  });
}

function optionSparkline(value: number, changePercent: number): number[] {
  const safeValue = Number.isFinite(value) ? value : 0;
  const denominator = 1 + clamp(changePercent, -99, 1_000) / 100;
  const start = denominator > 0 ? safeValue / denominator : safeValue;
  return Array.from({ length: 12 }, (_, index) =>
    round(start + (safeValue - start) * (index / 11), 6),
  );
}

function zoneStateForPrice(price: number, zones: readonly PriceZone[]): WatchlistAsset["zoneState"] {
  let nearest: { zone: PriceZone; distancePercent: number } | undefined;
  zones.forEach((zone) => {
    const low = Math.min(zone.proximal, zone.distal);
    const high = Math.max(zone.proximal, zone.distal);
    if (![low, high].every(Number.isFinite) || price <= 0) return;
    const boundary = price < low ? low : price > high ? high : price;
    const distancePercent = Math.abs(percentChange(price, boundary));
    if (!nearest || distancePercent < nearest.distancePercent) nearest = { zone, distancePercent };
  });
  if (!nearest || nearest.distancePercent > 1.5) return "balanced";
  return nearest.zone.type === "supply" ? "near supply" : "near demand";
}

export function deriveWatchlistAssets(
  assetOptions: readonly IndexAssetOption[],
  selectedSymbol: string,
  candles: readonly Candle[],
  zones: readonly PriceZone[],
): WatchlistAsset[] {
  const normalizedSelection = selectedSymbol.trim().toUpperCase();
  const uniqueAssets = Array.from(
    new Map(assetOptions.map((asset) => [asset.symbol.toUpperCase(), asset])).values(),
  ).sort((left, right) => {
    if (left.symbol.toUpperCase() === normalizedSelection) return -1;
    if (right.symbol.toUpperCase() === normalizedSelection) return 1;
    return 0;
  });
  const bars = usableCandles(candles);
  const selectedAnalytics = deriveMarketAnalytics(bars, inferTimeframe(bars));
  const selectedCloses = bars.slice(-12).map((candle) => candle.close);
  if (selectedCloses.length === 1) selectedCloses.unshift(selectedCloses[0]);

  return uniqueAssets.map((asset) => {
    const selected = asset.symbol.toUpperCase() === normalizedSelection;
    const value = selected && selectedAnalytics.summary.bars > 0
      ? selectedAnalytics.summary.endValue
      : asset.value;
    const changePercent = selected && selectedAnalytics.summary.bars > 1
      ? selectedAnalytics.summary.changePercent
      : asset.changePercent;
    return {
      symbol: asset.symbol,
      name: asset.name,
      value,
      changePercent,
      zoneState: selected ? zoneStateForPrice(value, zones) : "balanced",
      sparkline: selected && selectedCloses.length > 0
        ? selectedCloses
        : optionSparkline(value, changePercent),
    };
  });
}

export function calculateDataQuality(candles: readonly Candle[]): number {
  if (candles.length === 0) return 0;
  const total = candles.length;
  const validBars = candles.filter(isUsableCandle);
  const timestamps = candles
    .map(candleTimestamp)
    .filter((timestamp): timestamp is number => timestamp !== undefined);
  const timestampCoverage = timestamps.length / total;
  const pairCount = Math.max(timestamps.length - 1, 0);
  const orderedPairs = timestamps
    .slice(1)
    .filter((timestamp, index) => timestamp > timestamps[index]).length;
  const orderingRatio = pairCount > 0 ? orderedPairs / pairCount : timestamps.length === total ? 1 : 0;
  const intervals = timestamps
    .slice(1)
    .map((timestamp, index) => timestamp - timestamps[index])
    .filter((duration) => duration > 0)
    .sort((left, right) => left - right);
  let regularityRatio = timestamps.length === total && total <= 2 ? 1 : 0;
  if (intervals.length > 0) {
    const median = intervals[Math.floor(intervals.length / 2)];
    regularityRatio = intervals.filter(
      (duration) => duration >= median * 0.5 && duration <= median * 3.5,
    ).length / Math.max(pairCount, 1);
  }
  const providedVolumes = candles.filter((candle) => candle.volume !== undefined);
  const validVolumes = providedVolumes.filter(
    (candle) => typeof candle.volume === "number" && Number.isFinite(candle.volume) && candle.volume >= 0,
  );
  const volumeRatio = providedVolumes.length === 0 ? 1 : validVolumes.length / providedVolumes.length;
  const quality =
    (validBars.length / total) * 55 +
    timestampCoverage * 15 +
    orderingRatio * timestampCoverage * 10 +
    regularityRatio * timestampCoverage * 10 +
    volumeRatio * 10;
  return round(clamp(quality, 0, 100), 1);
}

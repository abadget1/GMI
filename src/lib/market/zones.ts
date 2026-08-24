import type {
  MarketTimeframe,
  OhlcvBar,
  SupplyDemandZone,
  TrendDirection,
  ZoneDetectionOptions,
  ZoneGrade,
  ZoneQuality,
  ZoneSide,
} from "./types.js";

const DEFAULTS: Required<ZoneDetectionOptions> = {
  timeframe: "15m" as MarketTimeframe,
  minImpulseCandles: 2,
  maxImpulseCandles: 3,
  minBodyToRangeRatio: 0.58,
  minRangeAtrMultiple: 1.25,
  atrPeriod: 14,
  baseLookback: 6,
  trendLookback: 20,
  structureLookback: 12,
  minTrendSlopePerBar: 0.00025,
};

type ResolvedOptions = Required<ZoneDetectionOptions>;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, precision = 2): number {
  const multiplier = 10 ** precision;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function validateBars(bars: readonly OhlcvBar[]): void {
  bars.forEach((bar, index) => {
    const values = [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume];
    if (!values.every(Number.isFinite)) {
      throw new TypeError(`Bar ${index} contains a non-finite value.`);
    }
    if (index > 0 && bar.time <= bars[index - 1].time) {
      throw new RangeError("Bars must be ordered by strictly increasing timestamps.");
    }
    if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) {
      throw new RangeError(`Bar ${index} has invalid OHLC bounds.`);
    }
  });
}

function resolveOptions(options: ZoneDetectionOptions): ResolvedOptions {
  const resolved: ResolvedOptions = { ...DEFAULTS, ...options };
  if (resolved.minImpulseCandles > resolved.maxImpulseCandles) {
    throw new RangeError("minImpulseCandles cannot exceed maxImpulseCandles.");
  }
  if (
    resolved.minBodyToRangeRatio <= 0 ||
    resolved.minBodyToRangeRatio > 1 ||
    resolved.minRangeAtrMultiple <= 0
  ) {
    throw new RangeError("Momentum thresholds must be positive and body ratio cannot exceed 1.");
  }
  for (const key of ["atrPeriod", "baseLookback", "trendLookback", "structureLookback"] as const) {
    if (!Number.isInteger(resolved[key]) || resolved[key] < 1) {
      throw new RangeError(`${key} must be a positive integer.`);
    }
  }
  return resolved;
}

function candleSide(bar: OhlcvBar): ZoneSide | undefined {
  if (bar.close > bar.open) return "demand";
  if (bar.close < bar.open) return "supply";
  return undefined;
}

function trueRange(bar: OhlcvBar, previousClose?: number): number {
  if (previousClose === undefined) return bar.high - bar.low;
  return Math.max(
    bar.high - bar.low,
    Math.abs(bar.high - previousClose),
    Math.abs(bar.low - previousClose),
  );
}

function averageTrueRangeBefore(
  bars: readonly OhlcvBar[],
  index: number,
  period: number,
): number {
  const start = Math.max(0, index - period);
  const ranges: number[] = [];
  for (let cursor = start; cursor < index; cursor += 1) {
    ranges.push(trueRange(bars[cursor], cursor > 0 ? bars[cursor - 1].close : undefined));
  }
  if (ranges.length === 0) return trueRange(bars[index]);
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length;
}

function isMomentumCandle(
  bars: readonly OhlcvBar[],
  index: number,
  side: ZoneSide,
  options: ResolvedOptions,
): boolean {
  const bar = bars[index];
  if (candleSide(bar) !== side) return false;
  const range = bar.high - bar.low;
  if (range <= 0) return false;
  const bodyRatio = Math.abs(bar.close - bar.open) / range;
  const baselineAtr = averageTrueRangeBefore(bars, index, options.atrPeriod);
  return (
    bodyRatio >= options.minBodyToRangeRatio &&
    range >= baselineAtr * options.minRangeAtrMultiple
  );
}

function findBaseBar(
  bars: readonly OhlcvBar[],
  impulseStartIndex: number,
  side: ZoneSide,
  lookback: number,
): number | undefined {
  const opposingSide: ZoneSide = side === "demand" ? "supply" : "demand";
  const earliest = Math.max(0, impulseStartIndex - lookback);
  for (let index = impulseStartIndex - 1; index >= earliest; index -= 1) {
    if (candleSide(bars[index]) === opposingSide) return index;
  }
  return undefined;
}

function trendAt(
  bars: readonly OhlcvBar[],
  index: number,
  lookback: number,
  minimumSlope: number,
): TrendDirection {
  const sample = bars.slice(Math.max(0, index - lookback), index).map((bar) => bar.close);
  if (sample.length < 3) return "flat";

  const xMean = (sample.length - 1) / 2;
  const yMean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
  let numerator = 0;
  let denominator = 0;
  sample.forEach((value, sampleIndex) => {
    numerator += (sampleIndex - xMean) * (value - yMean);
    denominator += (sampleIndex - xMean) ** 2;
  });
  const normalizedSlope = denominator === 0 || yMean === 0 ? 0 : numerator / denominator / yMean;
  if (normalizedSlope > minimumSlope) return "up";
  if (normalizedSlope < -minimumSlope) return "down";
  return "flat";
}

function hasBreakOfStructure(
  bars: readonly OhlcvBar[],
  baseBarIndex: number,
  impulseStartIndex: number,
  impulseEndIndex: number,
  side: ZoneSide,
  lookback: number,
): boolean {
  const prior = bars.slice(Math.max(0, baseBarIndex - lookback), baseBarIndex);
  if (prior.length === 0) return false;
  const impulse = bars.slice(impulseStartIndex, impulseEndIndex + 1);
  if (side === "demand") {
    const priorHigh = Math.max(...prior.map((bar) => bar.high));
    return impulse.some((bar) => bar.close > priorHigh);
  }
  const priorLow = Math.min(...prior.map((bar) => bar.low));
  return impulse.some((bar) => bar.close < priorLow);
}

function hasFairValueGap(
  bars: readonly OhlcvBar[],
  baseBarIndex: number,
  impulseEndIndex: number,
  side: ZoneSide,
): boolean {
  for (let index = Math.max(2, baseBarIndex + 2); index <= impulseEndIndex; index += 1) {
    const first = bars[index - 2];
    const third = bars[index];
    if (side === "demand" && third.low > first.high) return true;
    if (side === "supply" && third.high < first.low) return true;
  }
  return false;
}

function impulseStrength(
  bars: readonly OhlcvBar[],
  startIndex: number,
  endIndex: number,
  atrPeriod: number,
): number {
  const impulse = bars.slice(startIndex, endIndex + 1);
  const averageRange =
    impulse.reduce((sum, bar) => sum + (bar.high - bar.low), 0) / impulse.length;
  const averageBodyEfficiency =
    impulse.reduce(
      (sum, bar) => sum + Math.abs(bar.close - bar.open) / Math.max(bar.high - bar.low, Number.EPSILON),
      0,
    ) / impulse.length;
  const atr = averageTrueRangeBefore(bars, startIndex, atrPeriod);
  const expansionScore = clamp(averageRange / Math.max(atr, Number.EPSILON) / 2, 0, 1);
  return round((expansionScore * 0.6 + averageBodyEfficiency * 0.4) * 100);
}

function freshnessAfterDeparture(
  bars: readonly OhlcvBar[],
  impulseEndIndex: number,
  lower: number,
  upper: number,
  side: ZoneSide,
): { testCount: number; invalidated: boolean } {
  let testCount = 0;
  let invalidated = false;
  for (let index = impulseEndIndex + 1; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar.low <= upper && bar.high >= lower) testCount += 1;
    if (side === "demand" ? bar.close < lower : bar.close > upper) invalidated = true;
  }
  return { testCount, invalidated };
}

function gradeForScore(score: number): ZoneGrade {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  return "D";
}

function buildQuality(args: {
  testCount: number;
  invalidated: boolean;
  trendDirection: TrendDirection;
  trendAligned: boolean;
  breakOfStructure: boolean;
  fairValueGap: boolean;
  impulseStrength: number;
}): ZoneQuality {
  const freshness = args.invalidated ? "invalidated" : args.testCount === 0 ? "virgin" : "tested";
  const freshnessScore = freshness === "virgin" ? 25 : freshness === "tested" ? Math.max(5, 17 - args.testCount * 4) : 0;
  let score =
    freshnessScore +
    (args.trendAligned ? 20 : 0) +
    (args.breakOfStructure ? 25 : 0) +
    (args.fairValueGap ? 20 : 0) +
    args.impulseStrength * 0.1;
  if (args.invalidated) score = Math.min(score, 35);
  score = round(clamp(score, 0, 100));
  return {
    freshness,
    testCount: args.testCount,
    trendDirection: args.trendDirection,
    trendAligned: args.trendAligned,
    breakOfStructure: args.breakOfStructure,
    fairValueGap: args.fairValueGap,
    impulseStrength: args.impulseStrength,
    score,
    grade: gradeForScore(score),
  };
}

export function describeSupplyDemandZone(zone: SupplyDemandZone): string {
  const evidence = [
    zone.quality.freshness,
    zone.quality.trendAligned ? "trend-aligned" : undefined,
    zone.quality.breakOfStructure ? "BOS" : undefined,
    zone.quality.fairValueGap ? "FVG" : undefined,
  ].filter(Boolean);
  return `${zone.side === "demand" ? "Demand" : "Supply"} zone ${round(zone.lower, 4)}-${round(
    zone.upper,
    4,
  )}; base ${new Date(zone.createdAt).toISOString()}, impulse bars ${zone.impulseStartIndex}-${
    zone.impulseEndIndex
  }; ${evidence.join(", ")}.`;
}

/** Detects rally-base-rally and drop-base-drop zones from completed OHLCV bars. */
export function detectSupplyDemandZones(
  bars: readonly OhlcvBar[],
  options: ZoneDetectionOptions = {},
): SupplyDemandZone[] {
  if (bars.length === 0) return [];
  validateBars(bars);
  const resolved = resolveOptions(options);
  const zones: SupplyDemandZone[] = [];

  let index = 1;
  while (index < bars.length) {
    const side = candleSide(bars[index]);
    if (!side || !isMomentumCandle(bars, index, side, resolved)) {
      index += 1;
      continue;
    }

    let impulseEndIndex = index;
    while (
      impulseEndIndex + 1 < bars.length &&
      impulseEndIndex - index + 1 < resolved.maxImpulseCandles &&
      isMomentumCandle(bars, impulseEndIndex + 1, side, resolved)
    ) {
      impulseEndIndex += 1;
    }
    const impulseLength = impulseEndIndex - index + 1;
    if (impulseLength < resolved.minImpulseCandles) {
      index += 1;
      continue;
    }

    const baseBarIndex = findBaseBar(bars, index, side, resolved.baseLookback);
    if (baseBarIndex === undefined) {
      index = impulseEndIndex + 1;
      continue;
    }

    const base = bars[baseBarIndex];
    const formation = bars.slice(baseBarIndex, index);
    const proximal = base.open;
    const distal =
      side === "demand"
        ? Math.min(...formation.map((bar) => bar.low))
        : Math.max(...formation.map((bar) => bar.high));
    const lower = Math.min(proximal, distal);
    const upper = Math.max(proximal, distal);
    const trendDirection = trendAt(
      bars,
      index,
      resolved.trendLookback,
      resolved.minTrendSlopePerBar,
    );
    const trendAligned =
      (side === "demand" && trendDirection === "up") ||
      (side === "supply" && trendDirection === "down");
    const breakOfStructure = hasBreakOfStructure(
      bars,
      baseBarIndex,
      index,
      impulseEndIndex,
      side,
      resolved.structureLookback,
    );
    const fairValueGap = hasFairValueGap(bars, baseBarIndex, impulseEndIndex, side);
    const strength = impulseStrength(bars, index, impulseEndIndex, resolved.atrPeriod);
    const { testCount, invalidated } = freshnessAfterDeparture(
      bars,
      impulseEndIndex,
      lower,
      upper,
      side,
    );
    const quality = buildQuality({
      testCount,
      invalidated,
      trendDirection,
      trendAligned,
      breakOfStructure,
      fairValueGap,
      impulseStrength: strength,
    });

    const partialZone: SupplyDemandZone = {
      id: `${side}-${base.time}-${bars[index].time}`,
      side,
      timeframe: resolved.timeframe,
      baseBarIndex,
      impulseStartIndex: index,
      impulseEndIndex,
      createdAt: base.time,
      proximal,
      distal,
      lower,
      upper,
      coordinates: {
        startTime: base.time,
        endTime: bars[bars.length - 1].time,
        priceLow: lower,
        priceHigh: upper,
      },
      structuralDescription: "",
      quality,
    };
    partialZone.structuralDescription = describeSupplyDemandZone(partialZone);
    zones.push(partialZone);

    index = impulseEndIndex + 1;
    while (index < bars.length && isMomentumCandle(bars, index, side, resolved)) index += 1;
  }

  return zones;
}

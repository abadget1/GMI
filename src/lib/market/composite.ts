import type {
  AssetBarSeries,
  CompositeIndexBar,
  CompositeIndexOptions,
  CompositeIndexResult,
  ConstituentWeight,
  OhlcvBar,
} from "./types.js";

const DEFAULT_BASE_VALUE = 1_000;

function assertFinitePositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero.`);
  }
}

function validateBar(bar: OhlcvBar, symbol: string, index: number): void {
  const values = [bar.time, bar.open, bar.high, bar.low, bar.close, bar.volume];
  if (!values.every(Number.isFinite)) {
    throw new TypeError(`${symbol} bar ${index} contains a non-finite value.`);
  }
  if (bar.high < Math.max(bar.open, bar.close) || bar.low > Math.min(bar.open, bar.close)) {
    throw new RangeError(`${symbol} bar ${index} has invalid OHLC bounds.`);
  }
  if (bar.open <= 0 || bar.high <= 0 || bar.low <= 0 || bar.close <= 0) {
    throw new RangeError(`${symbol} bar ${index} prices must be greater than zero.`);
  }
  if (bar.volume < 0) {
    throw new RangeError(`${symbol} bar ${index} volume cannot be negative.`);
  }
}

function buildWeights(
  series: readonly AssetBarSeries[],
  weighting: CompositeIndexResult["weighting"],
): ConstituentWeight[] {
  const rawWeights = series.map(({ asset }) => {
    if (weighting === "equal") return 1;
    assertFinitePositive(asset.marketCapUsd ?? 0, `${asset.symbol} marketCapUsd`);
    return asset.marketCapUsd as number;
  });
  const total = rawWeights.reduce((sum, value) => sum + value, 0);

  return series.map(({ asset, bars, referencePrice }, index) => {
    const reference = referencePrice ?? bars[0]?.open;
    assertFinitePositive(reference, `${asset.symbol} referencePrice`);
    return {
      symbol: asset.symbol,
      weight: rawWeights[index] / total,
      referencePrice: reference,
    };
  });
}

function normalizedPrice(price: number, referencePrice: number, baseValue: number): number {
  return (price / referencePrice) * baseValue;
}

/**
 * Builds an index from synchronized component bars after rebasing each series.
 * Rebasing is essential: averaging raw S&P 500 and Nasdaq index point values would
 * otherwise make the higher nominal quote dominate an "equal" weighted index.
 */
export function calculateCompositeIndex(
  series: readonly AssetBarSeries[],
  options: CompositeIndexOptions = {},
): CompositeIndexResult {
  if (series.length === 0) {
    throw new RangeError("At least one component series is required.");
  }

  const weighting = options.weighting ?? "equal";
  const rangeMethod = options.rangeMethod ?? "weighted-bars";
  const baseValue = options.baseValue ?? DEFAULT_BASE_VALUE;
  assertFinitePositive(baseValue, "baseValue");

  const symbols = new Set<string>();
  const barCount = series[0].bars.length;
  if (barCount === 0) throw new RangeError("Component series cannot be empty.");

  for (const { asset, bars } of series) {
    if (symbols.has(asset.symbol)) {
      throw new RangeError(`Duplicate component symbol: ${asset.symbol}.`);
    }
    symbols.add(asset.symbol);
    if (bars.length !== barCount) {
      throw new RangeError("All component series must contain the same number of bars.");
    }
    bars.forEach((bar, index) => validateBar(bar, asset.symbol, index));
  }

  const firstTimeline = series[0].bars.map((bar) => bar.time);
  for (const { asset, bars } of series.slice(1)) {
    bars.forEach((bar, index) => {
      if (bar.time !== firstTimeline[index]) {
        throw new RangeError(
          `${asset.symbol} timestamp at bar ${index} is not aligned with the index timeline.`,
        );
      }
    });
  }

  const weights = buildWeights(series, weighting);
  const bars: CompositeIndexBar[] = firstTimeline.map((time, barIndex) => {
    const normalized = series.map(({ bars: componentBars }, componentIndex) => {
      const source = componentBars[barIndex];
      const { referencePrice, weight } = weights[componentIndex];
      return {
        weight,
        open: normalizedPrice(source.open, referencePrice, baseValue),
        high: normalizedPrice(source.high, referencePrice, baseValue),
        low: normalizedPrice(source.low, referencePrice, baseValue),
        close: normalizedPrice(source.close, referencePrice, baseValue),
        volume: source.volume,
      };
    });

    const open = normalized.reduce((sum, item) => sum + item.open * item.weight, 0);
    const close = normalized.reduce((sum, item) => sum + item.close * item.weight, 0);
    const weightedHigh = normalized.reduce((sum, item) => sum + item.high * item.weight, 0);
    const weightedLow = normalized.reduce((sum, item) => sum + item.low * item.weight, 0);
    const rawHigh =
      rangeMethod === "component-extremes"
        ? Math.max(...normalized.map((item) => item.high))
        : weightedHigh;
    const rawLow =
      rangeMethod === "component-extremes"
        ? Math.min(...normalized.map((item) => item.low))
        : weightedLow;

    return {
      time,
      open,
      high: Math.max(rawHigh, open, close),
      low: Math.min(rawLow, open, close),
      close,
      volume: normalized.reduce((sum, item) => sum + item.volume, 0),
      constituentCount: series.length,
    };
  });

  return { baseValue, weighting, rangeMethod, weights, bars };
}

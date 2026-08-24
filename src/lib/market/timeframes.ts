import type { MarketTimeframe, OhlcvBar } from "./types.js";

export const TIMEFRAME_DURATION_MS: Readonly<Record<MarketTimeframe, number>> = {
  "15m": 15 * 60 * 1_000,
  "30m": 30 * 60 * 1_000,
  "1h": 60 * 60 * 1_000,
  "4h": 4 * 60 * 60 * 1_000,
  "1d": 24 * 60 * 60 * 1_000,
};

export interface ResampleOptions {
  /** Shifts bucket boundaries, useful for exchange-session rather than UTC days. */
  bucketOffsetMinutes?: number;
}

/** Aggregates smaller completed candles into any modeled 15-minute-to-daily bucket. */
export function resampleOhlcv(
  bars: readonly OhlcvBar[],
  timeframe: MarketTimeframe,
  options: ResampleOptions = {},
): OhlcvBar[] {
  if (bars.length === 0) return [];
  const duration = TIMEFRAME_DURATION_MS[timeframe];
  const offset = (options.bucketOffsetMinutes ?? 0) * 60 * 1_000;
  if (!Number.isFinite(offset)) throw new RangeError("bucketOffsetMinutes must be finite.");

  const result: OhlcvBar[] = [];
  bars.forEach((bar, index) => {
    if (index > 0 && bar.time <= bars[index - 1].time) {
      throw new RangeError("Bars must be ordered by strictly increasing timestamps.");
    }
    const bucketTime = Math.floor((bar.time - offset) / duration) * duration + offset;
    const current = result[result.length - 1];
    if (!current || current.time !== bucketTime) {
      result.push({
        time: bucketTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
      });
      return;
    }
    current.high = Math.max(current.high, bar.high);
    current.low = Math.min(current.low, bar.low);
    current.close = bar.close;
    current.volume += bar.volume;
  });
  return result;
}

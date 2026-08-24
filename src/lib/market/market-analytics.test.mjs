import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateDataQuality,
  deriveActivityRegions,
  deriveHistoricalHeatmap,
  deriveMarketAnalytics,
  deriveWatchlistAssets,
} from "../../app/components/market/analytics.ts";

const start = Date.UTC(2026, 0, 5, 14, 30);
const closes = [100, 104, 102, 108, 106];
const candles = closes.map((close, index) => ({
  time: new Date(start + index * 15 * 60_000).toISOString(),
  timestamp: start + index * 15 * 60_000,
  open: index === 0 ? 99 : closes[index - 1],
  high: Math.max(index === 0 ? 99 : closes[index - 1], close) + 1,
  low: Math.min(index === 0 ? 99 : closes[index - 1], close) - 1,
  close,
  volume: 1_000 + index * 100,
}));

const zones = [
  {
    id: "demand-local",
    type: "demand",
    proximal: 101,
    distal: 98,
    strength: 82,
    tested: false,
    createdAt: "Jan 5",
    fairValueGap: true,
    breakOfStructure: true,
  },
];

test("derives coherent performance, risk, and quality from one candle series", () => {
  const result = deriveMarketAnalytics(candles, "15m");

  assert.equal(result.summary.bars, 5);
  assert.equal(result.summary.startValue, 100);
  assert.equal(result.summary.endValue, 106);
  assert.equal(result.summary.change, 6);
  assert.equal(result.summary.changePercent, 6);
  assert.equal(result.summary.high, 109);
  assert.equal(result.summary.low, 98);
  assert.equal(result.performance.at(-1).cumulativeReturnPercent, 6);
  assert.ok(result.summary.maxDrawdownPercent > 0);
  assert.ok(result.summary.realizedVolatilityPercent > 0);
  assert.equal(calculateDataQuality(candles), 100);
});

test("derives bounded OHLCV pressure, activity sessions, and selected watchlist history", () => {
  const heatmap = deriveHistoricalHeatmap(candles, zones, "LOCAL");
  const regions = deriveActivityRegions(candles);
  const watchlist = deriveWatchlistAssets(
    [{
      symbol: "LOCAL",
      name: "Local import",
      value: 1,
      change: 0,
      changePercent: 0,
      method: "Historical import",
      componentCount: 0,
      dataSource: "historical_import",
    }],
    "LOCAL",
    candles,
    zones,
  );

  assert.deepEqual(new Set(heatmap.map((metric) => metric.group)), new Set(["Momentum", "Structure", "Flow", "Risk"]));
  assert.ok(heatmap.every((metric) => metric.pressure >= -100 && metric.pressure <= 100));
  assert.equal(regions.length, 4);
  assert.equal(watchlist.length, 1);
  assert.equal(watchlist[0].value, 106);
  assert.deepEqual(watchlist[0].sparkline, closes);
  assert.equal(watchlist[0].zoneState, "balanced");
});

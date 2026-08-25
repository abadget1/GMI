import test from "node:test";
import assert from "node:assert/strict";

import { evaluateZoneAlert } from "./alerts.ts";
import { calculateCompositeIndex } from "./composite.ts";
import {
  DEMO_FOCUS_BARS,
  generateDeterministicBars,
} from "./demo-data.ts";
import {
  adaptCandleResponse,
  adaptMarketSnapshot,
  adaptZoneResponse,
  buildMarketRestUrls,
  filterMarketZones,
  formatMarketSymbolForDisplay,
  marketBucketAdvanced,
  marketBucketStart,
  marketReconnectDelayMs,
  mergeMarketQuoteIntoCandles,
  mergeMarketAlerts,
  normalizeMarketSymbol,
  normalizeMarketTimeframe,
  resolveMarketEndpoints,
  selectMarketSnapshot,
} from "./market-stream-adapter.ts";
import { calculateSupplyDemandScore } from "./scoring.ts";
import { resampleOhlcv } from "./timeframes.ts";
import { detectSupplyDemandZones } from "./zones.ts";

const time = (index) => Date.UTC(2026, 0, 2, 14, 30 + index * 15);
const bar = (index, open, high, low, close, volume = 100) => ({
  time: time(index),
  open,
  high,
  low,
  close,
  volume,
});

const asset = (symbol, marketCapUsd) => ({
  symbol,
  name: symbol,
  assetClass: "equity-index",
  currency: "USD",
  region: "Test",
  marketCapUsd,
});

test("normalizes nominal prices before equal-weight composite aggregation", () => {
  const result = calculateCompositeIndex(
    [
      {
        asset: asset("A", 3),
        bars: [bar(0, 100, 102, 98, 101), bar(1, 110, 120, 105, 115)],
      },
      {
        asset: asset("B", 1),
        bars: [bar(0, 200, 204, 196, 202), bar(1, 180, 220, 170, 210)],
      },
    ],
    { baseValue: 1_000, weighting: "equal", rangeMethod: "weighted-bars" },
  );

  assert.deepEqual(result.weights.map(({ weight }) => weight), [0.5, 0.5]);
  assert.deepEqual(
    (({ open, high, low, close }) => ({ open, high, low, close }))(result.bars[1]),
    { open: 1_000, high: 1_150, low: 950, close: 1_100 },
  );
});

test("formats continuous futures symbols for UI labels without changing provider symbols", () => {
  assert.equal(formatMarketSymbolForDisplay("ES1!"), "ES");
  assert.equal(formatMarketSymbolForDisplay("NQ1!"), "NQ");
  assert.equal(formatMarketSymbolForDisplay("SPY"), "SPY");
  assert.equal(formatMarketSymbolForDisplay("ES!"), "ES!");
});

test("supports market-cap weights and normalized cross-component wick extremes", () => {
  const series = [
    {
      asset: asset("A", 3),
      bars: [bar(0, 100, 102, 98, 101), bar(1, 110, 120, 105, 115)],
    },
    {
      asset: asset("B", 1),
      bars: [bar(0, 200, 204, 196, 202), bar(1, 180, 220, 170, 210)],
    },
  ];
  const weighted = calculateCompositeIndex(series, {
    weighting: "market-cap",
    baseValue: 1_000,
  });
  const extremes = calculateCompositeIndex(series, {
    weighting: "market-cap",
    rangeMethod: "component-extremes",
    baseValue: 1_000,
  });

  assert.deepEqual(weighted.weights.map(({ weight }) => weight), [0.75, 0.25]);
  assert.deepEqual(
    (({ open, high, low, close }) => ({ open, high, low, close }))(weighted.bars[1]),
    { open: 1_050, high: 1_175, low: 1_000, close: 1_125 },
  );
  assert.equal(extremes.bars[1].high, 1_200);
  assert.equal(extremes.bars[1].low, 850);
});

const demandFixture = [
  bar(0, 99, 100, 98.8, 99.5),
  bar(1, 99.5, 100.5, 99.2, 100.2),
  bar(2, 100.2, 101.4, 99.9, 101),
  bar(3, 101, 101.2, 99.6, 100.2),
  bar(4, 100.3, 104.4, 100.1, 104),
  bar(5, 104, 108.4, 103.7, 108),
  bar(6, 108, 109.3, 107.8, 109),
  bar(7, 109, 110, 108.8, 109.5),
];

test("detects the opposing base, 2-candle impulse, BOS, FVG, and virgin demand zone", () => {
  const zones = detectSupplyDemandZones(demandFixture);
  const demand = zones.find((zone) => zone.side === "demand");

  assert.ok(demand);
  assert.equal(demand.baseBarIndex, 3);
  assert.equal(demand.impulseStartIndex, 4);
  assert.equal(demand.impulseEndIndex, 5);
  assert.equal(demand.proximal, 101);
  assert.equal(demand.distal, 99.6);
  assert.equal(demand.quality.freshness, "virgin");
  assert.equal(demand.quality.trendAligned, true);
  assert.equal(demand.quality.breakOfStructure, true);
  assert.equal(demand.quality.fairValueGap, true);
  assert.match(demand.structuralDescription, /Demand zone 99.6-101/);
});

test("marks a zone tested after a later wick overlaps its price range", () => {
  const testedBars = [...demandFixture, bar(8, 109.5, 110, 100.5, 103)];
  const demand = detectSupplyDemandZones(testedBars).find((zone) => zone.side === "demand");
  assert.ok(demand);
  assert.equal(demand.quality.freshness, "tested");
  assert.equal(demand.quality.testCount, 1);
});

test("evaluates approaching, within, and crossing zone alert states", () => {
  const zone = detectSupplyDemandZones(demandFixture).find((candidate) => candidate.side === "demand");
  assert.ok(zone);

  assert.equal(evaluateZoneAlert({ zone, currentPrice: 101.4, proximityPercent: 0.5 }).status, "approaching");
  assert.equal(evaluateZoneAlert({ zone, currentPrice: 100.5 }).status, "within");
  const crossing = evaluateZoneAlert({ zone, previousPrice: 102, currentPrice: 100.5 });
  assert.equal(crossing.status, "crossed");
  assert.equal(crossing.crossedBoundary, "proximal");
  assert.equal(evaluateZoneAlert({ zone, previousPrice: 100, currentPrice: 99 }).crossedBoundary, "distal");
});

test("produces symmetric, bounded supply-demand scores", () => {
  const maximumDemand = calculateSupplyDemandScore({
    priceMomentum: 1,
    volumeImbalance: 1,
    orderBookImbalance: 1,
    physicalFlowBalance: 1,
    inventoryPressure: 1,
    logisticsPressure: 1,
  });
  assert.deepEqual(
    {
      netPressure: maximumDemand.netPressure,
      demandScore: maximumDemand.demandScore,
      supplyScore: maximumDemand.supplyScore,
      regime: maximumDemand.regime,
    },
    { netPressure: 100, demandScore: 100, supplyScore: 0, regime: "strong-demand" },
  );

  const balanced = calculateSupplyDemandScore({
    priceMomentum: 0,
    volumeImbalance: 0,
    orderBookImbalance: 0,
    physicalFlowBalance: 0,
    inventoryPressure: 0,
    logisticsPressure: 0,
  });
  assert.equal(balanced.regime, "balanced");
  assert.equal(balanced.demandScore + balanced.supplyScore, 100);
});

test("resamples 15-minute OHLCV into coherent hourly candles", () => {
  const source = [
    bar(0, 100, 102, 99, 101, 10),
    bar(1, 101, 104, 100, 103, 20),
    bar(2, 103, 105, 98, 99, 30),
    bar(3, 99, 101, 97, 100, 40),
  ];
  const [hour] = resampleOhlcv(source, "1h", { bucketOffsetMinutes: 30 });
  assert.deepEqual(
    (({ open, high, low, close, volume }) => ({ open, high, low, close, volume }))(hour),
    { open: 100, high: 105, low: 97, close: 100, volume: 100 },
  );
});

test("demo data is deterministic and contains both directional zone patterns", () => {
  const options = { seed: 7, startTime: time(0), count: 5, startPrice: 100 };
  assert.deepEqual(generateDeterministicBars(options), generateDeterministicBars(options));
  const sides = new Set(detectSupplyDemandZones(DEMO_FOCUS_BARS).map((zone) => zone.side));
  assert.equal(sides.has("demand"), true);
  assert.equal(sides.has("supply"), true);
});

test("normalizes UI timeframe/symbol aliases and derives matching API/WS endpoints", () => {
  assert.equal(normalizeMarketTimeframe("1D"), "1d");
  assert.equal(normalizeMarketSymbol("ndx"), "QQQ");
  assert.deepEqual(resolveMarketEndpoints({ apiUrl: "http://localhost:8000" }), {
    apiBaseUrl: "http://localhost:8000/api/v1",
    wsUrl: "ws://localhost:8000/ws/market",
  });
  assert.deepEqual(resolveMarketEndpoints({ wsUrl: "wss://markets.example/ws/market" }), {
    apiBaseUrl: "https://markets.example/api/v1",
    wsUrl: "wss://markets.example/ws/market",
  });
  const urls = buildMarketRestUrls("http://localhost:8000/api/v1/", "ndx", "1D", {
    candleLimit: 999,
    includeTestedZones: false,
    minZoneQuality: 72.5,
  });
  assert.equal(
    urls.candles,
    "http://localhost:8000/api/v1/index/candles?symbol=QQQ&timeframe=1d&limit=500",
  );
  assert.equal(
    urls.zones,
    "http://localhost:8000/api/v1/zones/QQQ?timeframe=1d&include_tested=false&min_quality=72.5",
  );
});

test("adapts REST candle and zone payloads with exact structural timestamps", () => {
  const candles = adaptCandleResponse(
    {
      candles: [
        {
          symbol: "IXIC",
          timeframe: "1d",
          timestamp: "2026-08-21T00:00:00Z",
          open: 6400,
          high: 6460,
          low: 6380,
          close: 6450,
          volume: 1234,
        },
      ],
    },
    "SPX",
    "1D",
  );
  const zones = adaptZoneResponse(
    {
      zones: [
        {
          id: "zone-1",
          symbol: "IXIC",
          timeframe: "1d",
          side: "demand",
          lower: 6200,
          upper: 6250,
          proximal: 6250,
          distal: 6200,
          base_timestamp: "2026-08-18T00:00:00Z",
          impulse_start: "2026-08-19T00:00:00Z",
          impulse_end: "2026-08-20T00:00:00Z",
          impulse_candles: 2,
          quality_score: 88.5,
          virgin: true,
          touch_count: 0,
          trend_aligned: true,
          fair_value_gap: true,
          break_of_structure: true,
          rationale: "2-candle impulsive departure",
        },
      ],
    },
    "SPX",
    "1D",
  );

  assert.equal(candles[0].time, Date.parse("2026-08-21T00:00:00Z"));
  assert.equal(candles[0].symbol, "SPY");
  assert.equal(zones[0].symbol, "SPY");
  assert.equal(zones[0].baseTimestamp, Date.parse("2026-08-18T00:00:00Z"));
  assert.equal(zones[0].impulseStart, Date.parse("2026-08-19T00:00:00Z"));
  assert.equal(zones[0].impulseEnd, Date.parse("2026-08-20T00:00:00Z"));
  assert.equal(zones[0].freshness, "virgin");
});

test("unwraps a full WS snapshot and selects symbol/timeframe data", () => {
  const snapshot = adaptMarketSnapshot({
    type: "market.snapshot",
    data: {
      sequence: 42,
      generated_at: "2026-08-21T20:00:00Z",
      prices: { GMI: 1092.79, SPY: 6476.18 },
      changes_pct: { GMI: 0.45, SPY: 0.33 },
      composite: {
        "1d": {
          symbol: "GMI",
          timeframe: "1d",
          timestamp: "2026-08-21T00:00:00Z",
          open: 1080,
          high: 1098,
          low: 1075,
          close: 1092.79,
          volume: 4000,
        },
      },
      pressure: [
        {
          key: "crude-oil",
          label: "Crude Oil",
          group: "Energy",
          score: 61,
          state: "demand",
          confidence: 0.82,
          drivers: { order_book: 0.7 },
        },
      ],
      zones: { GMI: [] },
      zones_by_timeframe: {
        "1d": {
          GMI: [
            {
              id: "zone-1",
              symbol: "GMI",
              timeframe: "1d",
              side: "supply",
              lower: 1100,
              upper: 1110,
              proximal: 1100,
              distal: 1110,
              base_timestamp: "2026-08-18T00:00:00Z",
              impulse_start: "2026-08-19T00:00:00Z",
              impulse_end: "2026-08-20T00:00:00Z",
              impulse_candles: 2,
              quality_score: 84,
              virgin: true,
              touch_count: 0,
              trend_aligned: true,
              fair_value_gap: true,
              break_of_structure: true,
              rationale: "daily supply departure",
            },
          ],
        },
      },
      alerts: [
        {
          id: "event-1",
          rule_id: "rule-1",
          zone_id: "zone-1",
          symbol: "GMI",
          timeframe: "1d",
          mode: "approach",
          side: "supply",
          price: 1092.79,
          distance_pct: 0.2,
          threshold_pct: 0.75,
          triggered_at: "2026-08-21T20:00:00Z",
          message: "GMI approach",
        },
      ],
    },
  });
  assert.ok(snapshot);
  const selected = selectMarketSnapshot(snapshot, "gmi", "1D");
  assert.equal(snapshot.sequence, 42);
  assert.equal(selected.currentValue, 1092.79);
  assert.equal(selected.liveCandle?.timeframe, "1d");
  assert.equal(selected.pressure[0].state, "demand");
  assert.equal(selected.zonesAreAuthoritative, true);
  assert.equal(selected.zones[0].timeframe, "1d");
  assert.equal(selected.alerts[0].mode, "approach");
  assert.equal(selected.alerts[0].thresholdPercent, 0.75);
});

test("merges transient alert frames by id and retains the newest 20 events", () => {
  const event = (id, triggeredAt, message = id) => ({
    id,
    ruleId: "rule-1",
    zoneId: "zone-1",
    symbol: "GMI",
    mode: "approach",
    side: "supply",
    price: 1092,
    distancePercent: 0.2,
    triggeredAt,
    message,
  });
  const current = Array.from({ length: 20 }, (_, index) => event(`old-${index}`, index + 1));
  const merged = mergeMarketAlerts(current, [event("old-19", 25, "updated"), event("new", 24)]);

  assert.equal(merged.length, 20);
  assert.equal(merged[0].id, "old-19");
  assert.equal(merged[0].message, "updated");
  assert.equal(merged[1].id, "new");
  assert.equal(new Set(merged.map(({ id }) => id)).size, 20);
});

test("rolls constituent quotes into canonical buckets with coherent OHLC", () => {
  const start = Date.parse("2026-08-21T20:00:00Z");
  const candles = [
    {
      symbol: "SPY",
      timeframe: "15m",
      time: start,
      open: 6470,
      high: 6478,
      low: 6468,
      close: 6474,
      volume: 100,
    },
  ];
  const sameBucket = mergeMarketQuoteIntoCandles(candles, {
    symbol: "SPY",
    timeframe: "15m",
    price: 6481,
    generatedAt: Date.parse("2026-08-21T20:14:59Z"),
  });
  const nextBucket = mergeMarketQuoteIntoCandles(sameBucket, {
      symbol: "SPY",
    timeframe: "15m",
    price: 6472,
    generatedAt: Date.parse("2026-08-21T20:15:01Z"),
  });
  const nextBucketLow = mergeMarketQuoteIntoCandles(nextBucket, {
    symbol: "SPX",
    timeframe: "15m",
    price: 6469,
    generatedAt: Date.parse("2026-08-21T20:16:00Z"),
  });

  assert.equal(sameBucket[0].open, 6470);
  assert.equal(sameBucket[0].high, 6481);
  assert.equal(sameBucket[0].low, 6468);
  assert.equal(nextBucketLow.length, 2);
  assert.equal(nextBucketLow[1].time, Date.parse("2026-08-21T20:15:00Z"));
  assert.deepEqual(
    (({ open, high, low, close, volume }) => ({ open, high, low, close, volume }))(
      nextBucketLow[1],
    ),
    { open: 6472, high: 6472, low: 6469, close: 6469, volume: 0 },
  );
});

test("detects bucket advancement and caps reconnect backoff", () => {
  const before = Date.parse("2026-08-21T23:59:59Z");
  const after = Date.parse("2026-08-22T00:00:01Z");
  assert.equal(marketBucketStart(before, "1D"), Date.parse("2026-08-21T00:00:00Z"));
  assert.equal(marketBucketAdvanced(before, after, "1D"), true);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 8].map((attempt) => marketReconnectDelayMs(attempt)),
    [750, 1500, 3000, 6000, 12000, 15000],
  );
});

test("applies identical quality and freshness policy to streamed zones", () => {
  const makeZone = (id, qualityScore, freshness) => ({
    id,
    symbol: "GMI",
    timeframe: "15m",
    side: "demand",
    lower: 100,
    upper: 101,
    proximal: 101,
    distal: 100,
    baseTimestamp: 1,
    impulseStart: 2,
    impulseEnd: 3,
    impulseCandles: 2,
    qualityScore,
    freshness,
    testCount: freshness === "tested" ? 1 : 0,
    trendAligned: true,
    fairValueGap: true,
    breakOfStructure: true,
    rationale: id,
  });
  const filtered = filterMarketZones(
    [makeZone("low", 59, "virgin"), makeZone("tested", 90, "tested"), makeZone("best", 88, "virgin")],
    { minZoneQuality: 60, includeTestedZones: false },
  );
  assert.deepEqual(filtered.map(({ id }) => id), ["best"]);
});

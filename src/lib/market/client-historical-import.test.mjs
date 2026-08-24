import test from "node:test";
import assert from "node:assert/strict";

import {
  ClientHistoricalImportError,
  deriveClientHistoricalZones,
  parseClientHistoricalImport,
} from "./client-historical-import.ts";

test("parses CSV aliases, quoted numbers, sorts rows, and applies last-row-wins deduplication", () => {
  const candles = parseClientHistoricalImport({
    text: `\ufeffdate,o,h,l,last,vol\n2025-01-03T00:00:00Z,103,108,102,107,"1,500"\n2025-01-02T00:00:00Z,100,104,99,103,1200\n2025-01-03T00:00:00Z,103,109,102,108,1700\n`,
    format: "csv",
    symbol: " brk.b ",
    timeframe: "1D",
  });

  assert.equal(candles.length, 2);
  assert.equal(candles[0].symbol, "BRK.B");
  assert.equal(candles[0].timeframe, "1d");
  assert.equal(candles[0].time, Date.parse("2025-01-02T00:00:00Z"));
  assert.deepEqual(
    (({ open, high, low, close, volume }) => ({ open, high, low, close, volume }))(candles[1]),
    { open: 103, high: 109, low: 102, close: 108, volume: 1700 },
  );
});

test("parses JSON data/candles envelopes and normalizes Unix seconds and milliseconds", () => {
  const seconds = 1_735_776_000;
  const milliseconds = 1_735_862_400_000;
  const candles = parseClientHistoricalImport({
    text: JSON.stringify({
      data: [
        { datetime: seconds, o: 10, h: 12, l: 9, c: 11 },
        { time: milliseconds, open: 11, high: 13, low: 10, last: 12, v: 25 },
      ],
    }),
    format: "json",
    symbol: "btc-usd",
    timeframe: "15m",
  });

  assert.deepEqual(candles.map((candle) => candle.time), [seconds * 1_000, milliseconds]);
  assert.deepEqual(candles.map((candle) => candle.volume), [0, 25]);
});

test("rejects invalid rows and enforces the 10,000 input-row limit before deduplication", () => {
  assert.throws(
    () => parseClientHistoricalImport({
      text: "timestamp,open,high,low,close\n2025-01-02,10,9,8,11\n",
      format: "csv",
      symbol: "BAD",
      timeframe: "1d",
    }),
    (error) => error instanceof ClientHistoricalImportError && /OHLC/.test(error.message),
  );
  assert.throws(
    () => parseClientHistoricalImport({
      text: JSON.stringify([{ timestamp: "2025-01-02", open: true, high: 11, low: 9, close: 10 }]),
      format: "json",
      symbol: "BAD",
      timeframe: "1d",
    }),
    /open must be a finite number/,
  );

  const duplicate = { timestamp: "2025-01-02T00:00:00Z", open: 10, high: 11, low: 9, close: 10 };
  assert.throws(
    () => parseClientHistoricalImport({
      text: JSON.stringify(Array.from({ length: 10_001 }, () => duplicate)),
      format: "json",
      symbol: "LIMIT",
      timeframe: "1d",
    }),
    /10,000-row limit/,
  );
});

test("derives chart-ready market zones from parsed local candles", () => {
  const start = Date.UTC(2026, 0, 2, 14, 30);
  const closes = [99.5, 100.2, 101, 100.2, 104, 108, 109, 109.5];
  const rows = [
    [99, 100, 98.8],
    [99.5, 100.5, 99.2],
    [100.2, 101.4, 99.9],
    [101, 101.2, 99.6],
    [100.3, 104.4, 100.1],
    [104, 108.4, 103.7],
    [108, 109.3, 107.8],
    [109, 110, 108.8],
  ].map(([open, high, low], index) => ({
    timestamp: start + index * 15 * 60_000,
    open,
    high,
    low,
    close: closes[index],
    volume: 100,
  }));
  const candles = parseClientHistoricalImport({
    text: JSON.stringify({ candles: rows }),
    format: "json",
    symbol: "LOCAL",
    timeframe: "15m",
  });
  const zones = deriveClientHistoricalZones(candles);
  const demand = zones.find((zone) => zone.side === "demand");

  assert.ok(demand);
  assert.equal(demand.symbol, "LOCAL");
  assert.equal(demand.timeframe, "15m");
  assert.equal(demand.proximal, 101);
  assert.equal(demand.distal, 99.6);
  assert.equal(demand.impulseCandles, 2);
  assert.equal(demand.baseTimestamp, rows[3].timestamp);
  assert.match(demand.rationale, /Demand zone/);
});

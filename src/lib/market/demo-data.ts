import type {
  AssetBarSeries,
  GlobalMarketSnapshot,
  MarketAsset,
  OhlcvBar,
  PressureMarketDefinition,
  TickerSnapshot,
} from "./types.js";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1_000;
export const DEMO_UPDATED_AT = Date.UTC(2026, 7, 21, 20, 0, 0);

export interface DeterministicBarOptions {
  seed: number;
  startTime: number;
  count: number;
  startPrice: number;
  intervalMs?: number;
  driftPerBar?: number;
  volatility?: number;
  baseVolume?: number;
}

function round(value: number, precision = 2): number {
  const multiplier = 10 ** precision;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

/** Small seeded generator for repeatable screenshots, stories, and tests. */
export function generateDeterministicBars({
  seed,
  startTime,
  count,
  startPrice,
  intervalMs = FIFTEEN_MINUTES_MS,
  driftPerBar = 0.00008,
  volatility = 0.0012,
  baseVolume = 1_000_000,
}: DeterministicBarOptions): OhlcvBar[] {
  if (!Number.isInteger(count) || count < 1) throw new RangeError("count must be a positive integer.");
  if (startPrice <= 0 || intervalMs <= 0 || baseVolume < 0) {
    throw new RangeError("startPrice and intervalMs must be positive; baseVolume cannot be negative.");
  }

  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(1_664_525, state) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  const bars: OhlcvBar[] = [];
  let previousClose = startPrice;

  for (let index = 0; index < count; index += 1) {
    const open = previousClose;
    const returnFraction = driftPerBar + (random() - 0.5) * volatility * 2;
    const close = Math.max(0.01, open * (1 + returnFraction));
    const wickScale = open * volatility * (0.2 + random() * 0.45);
    const high = Math.max(open, close) + wickScale;
    const low = Math.max(0.01, Math.min(open, close) - wickScale * (0.7 + random() * 0.6));
    const volume = baseVolume * (0.72 + random() * 0.58);
    const bar = {
      time: startTime + index * intervalMs,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: Math.round(volume),
    };
    bars.push(bar);
    previousClose = bar.close;
  }
  return bars;
}

export const SP500_ASSET: MarketAsset = {
  symbol: "SPX",
  name: "S&P 500",
  assetClass: "equity-index",
  currency: "USD",
  region: "United States",
  sector: "Broad Market",
  marketCapUsd: 52_000_000_000_000,
};

export const NASDAQ_ASSET: MarketAsset = {
  symbol: "IXIC",
  name: "Nasdaq Composite",
  assetClass: "equity-index",
  currency: "USD",
  region: "United States",
  sector: "Technology Growth",
  marketCapUsd: 31_000_000_000_000,
};

const COMPONENT_START = Date.UTC(2026, 7, 21, 13, 30, 0);

export const DEMO_COMPONENT_SERIES: readonly AssetBarSeries[] = [
  {
    asset: SP500_ASSET,
    bars: generateDeterministicBars({
      seed: 5_001,
      startTime: COMPONENT_START,
      count: 27,
      startPrice: 6_390.4,
      driftPerBar: 0.00009,
      volatility: 0.00075,
      baseVolume: 2_800_000_000,
    }),
  },
  {
    asset: NASDAQ_ASSET,
    bars: generateDeterministicBars({
      seed: 10_001,
      startTime: COMPONENT_START,
      count: 27,
      startPrice: 23_310.8,
      driftPerBar: 0.00014,
      volatility: 0.00105,
      baseVolume: 3_900_000_000,
    }),
  },
];

function createFocusBars(): OhlcvBar[] {
  let state = 8_823;
  const random = () => {
    state = (Math.imul(1_103_515_245, state) + 12_345) >>> 0;
    return state / 4_294_967_296;
  };
  const bars: OhlcvBar[] = [];
  let previousClose = 1_087.5;

  for (let index = 0; index < 42; index += 1) {
    const open = previousClose;
    let close: number;
    let high: number;
    let low: number;
    let volumeFactor = 0.8 + random() * 0.35;

    if (index === 12) {
      close = open - 4.8;
      high = open + 1.6;
      low = close - 2.8;
    } else if (index >= 13 && index <= 15) {
      close = open + (index === 13 ? 14.5 : index === 14 ? 13.2 : 11.4);
      high = close + 2.1;
      low = open - 0.8;
      volumeFactor = 1.65 + (index - 13) * 0.14;
    } else if (index === 24) {
      close = open + 4.2;
      high = close + 2.3;
      low = open - 2.6;
    } else if (index >= 25 && index <= 27) {
      close = open - (index === 25 ? 14.1 : index === 26 ? 12.8 : 10.9);
      high = open + 0.9;
      low = close - 2.2;
      volumeFactor = 1.72 + (index - 25) * 0.12;
    } else {
      const directionalBias = index < 12 ? 0.7 : index < 24 ? 0.45 : index < 35 ? 0.35 : 0.15;
      close = open + directionalBias + (random() - 0.5) * 2.2;
      high = Math.max(open, close) + 1.1 + random() * 1.2;
      low = Math.min(open, close) - 1.1 - random() * 1.2;
    }

    const bar = {
      time: COMPONENT_START + index * FIFTEEN_MINUTES_MS,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: Math.round(1_850_000 * volumeFactor),
    };
    bars.push(bar);
    previousClose = bar.close;
  }
  return bars;
}

/** A deterministic synthetic index series with both demand and supply impulses. */
export const DEMO_FOCUS_BARS: readonly OhlcvBar[] = createFocusBars();

export const DEMO_TICKERS: readonly TickerSnapshot[] = [
  { symbol: "SPX", label: "S&P 500", value: 6_390.4, changePercent: 0.42, decimals: 2 },
  { symbol: "IXIC", label: "Nasdaq Composite", value: 23_310.8, changePercent: 0.76, decimals: 2 },
  { symbol: "EURUSD", label: "EUR / USD", value: 1.1718, changePercent: -0.13, decimals: 4 },
  { symbol: "USDJPY", label: "USD / JPY", value: 147.36, changePercent: 0.24, decimals: 2 },
  { symbol: "CL", label: "WTI Crude", value: 63.84, changePercent: 1.18, decimals: 2 },
  { symbol: "GC", label: "Gold", value: 3_385.6, changePercent: -0.31, decimals: 1 },
];

export const DEMO_GLOBAL_MARKETS: readonly GlobalMarketSnapshot[] = [
  { id: "new-york", label: "S&P 500", symbol: "SPX", region: "Americas", latitude: 40.71, longitude: -74.01, value: 6_390.4, changePercent: 0.42, status: "open" },
  { id: "sao-paulo", label: "Bovespa", symbol: "IBOV", region: "Americas", latitude: -23.55, longitude: -46.63, value: 137_910, changePercent: -0.28, status: "open" },
  { id: "london", label: "FTSE 100", symbol: "UKX", region: "Europe", latitude: 51.51, longitude: -0.13, value: 9_214.3, changePercent: 0.18, status: "closed" },
  { id: "frankfurt", label: "DAX", symbol: "DAX", region: "Europe", latitude: 50.11, longitude: 8.68, value: 24_278.1, changePercent: 0.51, status: "closed" },
  { id: "tokyo", label: "Nikkei 225", symbol: "NKY", region: "Asia Pacific", latitude: 35.68, longitude: 139.76, value: 38_920.7, changePercent: -0.47, status: "closed" },
  { id: "hong-kong", label: "Hang Seng", symbol: "HSI", region: "Asia Pacific", latitude: 22.32, longitude: 114.17, value: 25_114.6, changePercent: 0.64, status: "closed" },
];

export const DEMO_PRESSURE_MARKETS: readonly PressureMarketDefinition[] = [
  {
    id: "wti",
    label: "WTI Crude",
    symbol: "CL",
    group: "Energy",
    unit: "USD/bbl",
    lastPrice: 63.84,
    changePercent: 1.18,
    inputs: { priceMomentum: 0.52, volumeImbalance: 0.41, orderBookImbalance: 0.64, physicalFlowBalance: 0.33, inventoryPressure: 0.48, logisticsPressure: 0.24 },
  },
  {
    id: "natural-gas",
    label: "Natural Gas",
    symbol: "NG",
    group: "Energy",
    unit: "USD/MMBtu",
    lastPrice: 2.91,
    changePercent: -1.46,
    inputs: { priceMomentum: -0.58, volumeImbalance: -0.32, orderBookImbalance: -0.44, physicalFlowBalance: -0.16, inventoryPressure: -0.51, logisticsPressure: 0.08 },
  },
  {
    id: "corn",
    label: "Corn",
    symbol: "ZC",
    group: "Agriculture",
    unit: "USd/bu",
    lastPrice: 412.75,
    changePercent: 0.37,
    inputs: { priceMomentum: 0.21, volumeImbalance: 0.18, orderBookImbalance: 0.14, physicalFlowBalance: 0.36, inventoryPressure: 0.3, logisticsPressure: 0.12 },
  },
  {
    id: "wheat",
    label: "Wheat",
    symbol: "ZW",
    group: "Agriculture",
    unit: "USd/bu",
    lastPrice: 527.5,
    changePercent: -0.82,
    inputs: { priceMomentum: -0.36, volumeImbalance: -0.2, orderBookImbalance: -0.28, physicalFlowBalance: -0.31, inventoryPressure: -0.12, logisticsPressure: 0.16 },
  },
  {
    id: "copper",
    label: "Copper",
    symbol: "HG",
    group: "Industrial Metals",
    unit: "USD/lb",
    lastPrice: 4.57,
    changePercent: 0.91,
    inputs: { priceMomentum: 0.44, volumeImbalance: 0.27, orderBookImbalance: 0.52, physicalFlowBalance: 0.61, inventoryPressure: 0.55, logisticsPressure: 0.19 },
  },
  {
    id: "aluminum",
    label: "Aluminum",
    symbol: "ALI",
    group: "Industrial Metals",
    unit: "USD/mt",
    lastPrice: 2_621,
    changePercent: -0.24,
    inputs: { priceMomentum: -0.16, volumeImbalance: -0.08, orderBookImbalance: -0.21, physicalFlowBalance: 0.05, inventoryPressure: -0.29, logisticsPressure: 0.14 },
  },
  {
    id: "memory",
    label: "Memory",
    symbol: "DRAM",
    group: "Semiconductors",
    unit: "index",
    lastPrice: 118.4,
    changePercent: 2.08,
    inputs: { priceMomentum: 0.72, volumeImbalance: 0.68, orderBookImbalance: 0.59, physicalFlowBalance: 0.74, inventoryPressure: 0.63, logisticsPressure: 0.41 },
  },
  {
    id: "foundry",
    label: "Foundry Capacity",
    symbol: "FOUNDRY",
    group: "Semiconductors",
    unit: "% utilization",
    lastPrice: 86.7,
    changePercent: 0.31,
    inputs: { priceMomentum: 0.18, volumeImbalance: 0.22, orderBookImbalance: 0.31, physicalFlowBalance: 0.45, inventoryPressure: 0.39, logisticsPressure: 0.34 },
  },
];

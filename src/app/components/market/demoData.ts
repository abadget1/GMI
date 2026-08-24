import type {
  ActivityRegion,
  Candle,
  HeatmapMetric,
  IndexAssetOption,
  MarketAlert,
  MarketTicker,
  PriceZone,
  WatchlistAsset,
} from "./types";

export const demoIndexAssets: IndexAssetOption[] = [
  { symbol: "GMI", name: "Global Market Index", value: 1092.79, change: 4.83, changePercent: 0.45, method: "Equal-weight normalized", componentCount: 2 },
  { symbol: "SPX", name: "S&P 500", value: 6476.18, change: 21.42, changePercent: 0.33, method: "Float-adjusted cap", componentCount: 503 },
  { symbol: "IXIC", name: "Nasdaq Composite", value: 23892.74, change: 112.18, changePercent: 0.47, method: "Market-cap weighted", componentCount: 2987 },
];

export const demoTickers: MarketTicker[] = [
  { symbol: "GMI", name: "Global Market Index", value: 1092.79, change: 4.83, changePercent: 0.45 },
  { symbol: "SPX", name: "S&P 500", value: 6476.18, change: 21.42, changePercent: 0.33 },
  { symbol: "IXIC", name: "Nasdaq Composite", value: 23892.74, change: 112.18, changePercent: 0.47 },
  { symbol: "EUR/USD", name: "Euro / Dollar", value: 1.1684, change: -0.0021, changePercent: -0.18, precision: 4 },
  { symbol: "DXY", name: "US Dollar Index", value: 98.14, change: -0.21, changePercent: -0.21 },
  { symbol: "WTI", name: "Crude Oil", value: 64.72, change: 0.88, changePercent: 1.38, prefix: "$" },
  { symbol: "GOLD", name: "Gold Spot", value: 3417.6, change: 17.4, changePercent: 0.51, prefix: "$" },
];

export const demoRegions: ActivityRegion[] = [
  { id: "ny", city: "New York", exchange: "NYSE / Nasdaq", x: 176, y: 135, changePercent: 0.42, status: "open", volumeLabel: "$184B" },
  { id: "sao", city: "São Paulo", exchange: "B3", x: 242, y: 238, changePercent: -0.31, status: "open", volumeLabel: "$8.4B" },
  { id: "lon", city: "London", exchange: "LSE", x: 345, y: 106, changePercent: 0.18, status: "open", volumeLabel: "$22B" },
  { id: "fra", city: "Frankfurt", exchange: "Xetra", x: 376, y: 112, changePercent: -0.14, status: "open", volumeLabel: "$11B" },
  { id: "mum", city: "Mumbai", exchange: "NSE", x: 487, y: 164, changePercent: 0.63, status: "closed", volumeLabel: "$13B" },
  { id: "hk", city: "Hong Kong", exchange: "HKEX", x: 572, y: 151, changePercent: 0.77, status: "closed", volumeLabel: "$19B" },
  { id: "tok", city: "Tokyo", exchange: "JPX", x: 625, y: 135, changePercent: -0.52, status: "closed", volumeLabel: "$34B" },
  { id: "syd", city: "Sydney", exchange: "ASX", x: 625, y: 249, changePercent: 0.21, status: "pre-market", volumeLabel: "$5.9B" },
];

const closes = [
  1079.2, 1081.6, 1080.8, 1083.9, 1085.2, 1084.3, 1087.8, 1089.6, 1088.7,
  1086.9, 1088.2, 1091.5, 1093.8, 1094.7, 1092.1, 1089.8, 1088.9, 1086.7,
  1087.5, 1089.2, 1088.6, 1090.8, 1091.9, 1090.6, 1089.7, 1091.2, 1090.9,
  1092.5, 1091.8, 1093.1, 1094.6, 1093.7, 1095.8, 1094.9, 1091.8, 1092.79,
];

const DEMO_CANDLE_START_TIMESTAMP = Date.UTC(2026, 7, 21, 13, 30);
const DEMO_CANDLE_INTERVAL_MS = 15 * 60 * 1000;
const demoTimestamp = (index: number) =>
  DEMO_CANDLE_START_TIMESTAMP + index * DEMO_CANDLE_INTERVAL_MS;

function demoTimeLabel(index: number) {
  const totalMinutes = 9 * 60 + 30 + index * 15;
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;
  return `${hour}:${String(minutes).padStart(2, "0")}`;
}

export const demoCandles: Candle[] = closes.map((close, index) => {
  const previous = index === 0 ? 1077.8 : closes[index - 1];
  const open = Number((previous + (index % 4 === 0 ? -0.45 : index % 3 === 0 ? 0.32 : -0.12)).toFixed(2));
  const wick = 0.65 + (index % 5) * 0.17;
  return {
    time: demoTimeLabel(index),
    timestamp: demoTimestamp(index),
    open,
    close,
    high: Number((Math.max(open, close) + wick).toFixed(2)),
    low: Number((Math.min(open, close) - wick * 0.86).toFixed(2)),
    volume: 1600000 + ((index * 76123) % 2100000),
  };
});

export const demoZones: PriceZone[] = [
  {
    id: "supply-1",
    type: "supply",
    proximal: 1095,
    distal: 1101,
    strength: 87,
    tested: false,
    createdAt: "Aug 21 · 12:45",
    baseBarIndex: 13,
    impulseStartIndex: 14,
    impulseEndIndex: 17,
    baseTimestamp: demoTimestamp(13),
    impulseStartTimestamp: demoTimestamp(14),
    impulseEndTimestamp: demoTimestamp(17),
    fairValueGap: true,
    breakOfStructure: true,
  },
  {
    id: "demand-1",
    type: "demand",
    proximal: 1075,
    distal: 1068,
    strength: 93,
    tested: false,
    createdAt: "Aug 21 · 10:45",
    baseBarIndex: 5,
    impulseStartIndex: 6,
    impulseEndIndex: 7,
    baseTimestamp: demoTimestamp(5),
    impulseStartTimestamp: demoTimestamp(6),
    impulseEndTimestamp: demoTimestamp(7),
    fairValueGap: true,
    breakOfStructure: true,
  },
];

export const demoHeatmap: HeatmapMetric[] = [
  { id: "oil", name: "Crude oil", ticker: "WTI", group: "Energy", pressure: 72, changePercent: 1.38, flowLabel: "Draw 2.1M bbl" },
  { id: "gas", name: "Natural gas", ticker: "NG", group: "Energy", pressure: -46, changePercent: -1.82, flowLabel: "Build 18 Bcf" },
  { id: "coal", name: "Thermal coal", ticker: "COAL", group: "Energy", pressure: 28, changePercent: 0.42, flowLabel: "Tightening" },
  { id: "corn", name: "Corn", ticker: "CORN", group: "Agriculture", pressure: -61, changePercent: -1.11, flowLabel: "Surplus 4.2%" },
  { id: "wheat", name: "Wheat", ticker: "WHEAT", group: "Agriculture", pressure: 34, changePercent: 0.66, flowLabel: "Exports +8%" },
  { id: "soy", name: "Soybeans", ticker: "SOY", group: "Agriculture", pressure: 57, changePercent: 1.04, flowLabel: "Stocks -3%" },
  { id: "copper", name: "Copper", ticker: "HG", group: "Industrial metals", pressure: 81, changePercent: 1.72, flowLabel: "Stocks -12%" },
  { id: "alum", name: "Aluminum", ticker: "ALI", group: "Industrial metals", pressure: 43, changePercent: 0.81, flowLabel: "Tightening" },
  { id: "nickel", name: "Nickel", ticker: "NI", group: "Industrial metals", pressure: -53, changePercent: -0.94, flowLabel: "Surplus 6.8%" },
  { id: "logic", name: "Logic chips", ticker: "LOGIC", group: "Semiconductors", pressure: 76, changePercent: 2.12, flowLabel: "Lead time +9d" },
  { id: "memory", name: "Memory", ticker: "DRAM", group: "Semiconductors", pressure: 64, changePercent: 1.48, flowLabel: "Inventory -7%" },
  { id: "foundry", name: "Foundry", ticker: "FOUNDRY", group: "Semiconductors", pressure: 48, changePercent: 0.73, flowLabel: "Utilization 91%" },
];

export const demoAlerts: MarketAlert[] = [
  { id: "a1", symbol: "GMI", zoneType: "supply", condition: "approaching", thresholdPercent: 0.5, currentDistancePercent: 0.2, triggeredAt: "Just now" },
  { id: "a2", symbol: "WTI", zoneType: "demand", condition: "inside", thresholdPercent: 0.8, currentDistancePercent: 0, triggeredAt: "4m ago" },
  { id: "a3", symbol: "IXIC", zoneType: "demand", condition: "crossed", thresholdPercent: 0.4, currentDistancePercent: -0.1, triggeredAt: "18m ago" },
];

export const demoWatchlist: WatchlistAsset[] = [
  { symbol: "SPX", name: "S&P 500", value: 6476.18, changePercent: 0.33, zoneState: "balanced", sparkline: [42, 44, 43, 46, 47, 49, 48, 52, 54, 53, 57, 59] },
  { symbol: "IXIC", name: "Nasdaq Composite", value: 23892.74, changePercent: 0.47, zoneState: "near supply", sparkline: [34, 38, 37, 40, 43, 45, 44, 49, 52, 55, 54, 58] },
  { symbol: "DXY", name: "Dollar index", value: 98.14, changePercent: -0.21, zoneState: "near demand", sparkline: [58, 55, 56, 52, 50, 49, 51, 48, 45, 46, 43, 41] },
  { symbol: "WTI", name: "Crude oil", value: 64.72, changePercent: 1.38, zoneState: "near supply", sparkline: [28, 31, 30, 34, 38, 37, 43, 45, 49, 52, 56, 61] },
  { symbol: "HG", name: "Copper", value: 4.53, changePercent: 1.72, zoneState: "balanced", sparkline: [38, 39, 42, 41, 44, 48, 46, 51, 53, 52, 57, 60] },
];

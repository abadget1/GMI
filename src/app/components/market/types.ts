export type MarketDirection = "up" | "down" | "flat";

export type ChartTimeframe = "15m" | "30m" | "1h" | "4h" | "1d";

export type MarketSessionStatus = "open" | "pre-market" | "closed";

export interface MarketTicker {
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
  precision?: number;
  prefix?: string;
  suffix?: string;
  session?: string;
}

export interface IndexAssetOption {
  symbol: string;
  name: string;
  value: number;
  change: number;
  changePercent: number;
  method: string;
  componentCount: number;
  assetClass?: "index" | "forex" | "commodity" | "crypto" | "custom";
  dataSource?: "alpha_vantage" | "historical_import" | "simulator";
  priceBasis?: string;
  supportedTimeframes?: ChartTimeframe[];
}

export interface ActivityRegion {
  id: string;
  city: string;
  exchange: string;
  x: number;
  y: number;
  changePercent: number;
  status: MarketSessionStatus;
  volumeLabel: string;
}

export interface Candle {
  time: string;
  /** Epoch milliseconds used to align server-side structural coordinates. */
  timestamp?: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface PriceZone {
  id: string;
  type: "supply" | "demand";
  proximal: number;
  distal: number;
  strength: number;
  tested: boolean;
  createdAt: string;
  /** Structural coordinates are optional for legacy/demo consumers. */
  baseBarIndex?: number;
  impulseStartIndex?: number;
  impulseEndIndex?: number;
  /** Epoch milliseconds; preferred over indices when the visible window shifts. */
  baseTimestamp?: number;
  impulseStartTimestamp?: number;
  impulseEndTimestamp?: number;
  fairValueGap?: boolean;
  breakOfStructure?: boolean;
}

export type HeatmapGroup =
  | "Energy"
  | "Agriculture"
  | "Industrial metals"
  | "Semiconductors";

export interface HeatmapMetric {
  id: string;
  name: string;
  ticker: string;
  group: HeatmapGroup;
  pressure: number;
  changePercent: number;
  flowLabel: string;
}

export type AlertCondition = "approaching" | "inside" | "crossed";

export interface MarketAlert {
  id: string;
  symbol: string;
  zoneType: PriceZone["type"];
  condition: AlertCondition;
  thresholdPercent: number;
  currentDistancePercent: number;
  triggeredAt: string;
  /** True for a configured rule that has not emitted a trigger event yet. */
  armed?: boolean;
}

export interface WatchlistAsset {
  symbol: string;
  name: string;
  value: number;
  changePercent: number;
  zoneState: "near supply" | "near demand" | "balanced";
  sparkline: number[];
}

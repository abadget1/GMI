/** Unix epoch milliseconds. Keeping one time unit at the boundary prevents chart drift. */
export type TimestampMs = number;

export type MarketTimeframe = "15m" | "30m" | "1h" | "4h" | "1d";

export interface OhlcvBar {
  time: TimestampMs;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type AssetClass =
  | "equity-index"
  | "currency"
  | "commodity"
  | "fixed-income"
  | "digital-asset";

export interface MarketAsset {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  currency: string;
  region: string;
  sector?: string;
  /** Capital represented by the series, expressed in USD. */
  marketCapUsd?: number;
}

export interface AssetBarSeries {
  asset: MarketAsset;
  bars: readonly OhlcvBar[];
  /** Defaults to the first bar's open. */
  referencePrice?: number;
}

export type CompositeWeighting = "equal" | "market-cap";

/**
 * `weighted-bars` builds a coherent synthetic candle from weighted normalized bars.
 * `component-extremes` follows the requested cross-asset wick convention.
 */
export type CompositeRangeMethod = "weighted-bars" | "component-extremes";

export interface CompositeIndexOptions {
  weighting?: CompositeWeighting;
  rangeMethod?: CompositeRangeMethod;
  baseValue?: number;
}

export interface ConstituentWeight {
  symbol: string;
  weight: number;
  referencePrice: number;
}

export interface CompositeIndexBar extends OhlcvBar {
  constituentCount: number;
}

export interface CompositeIndexResult {
  baseValue: number;
  weighting: CompositeWeighting;
  rangeMethod: CompositeRangeMethod;
  weights: readonly ConstituentWeight[];
  bars: readonly CompositeIndexBar[];
}

export type ZoneSide = "demand" | "supply";
export type TrendDirection = "up" | "down" | "flat";
export type ZoneFreshness = "virgin" | "tested" | "invalidated";
export type ZoneGrade = "A" | "B" | "C" | "D";

export interface ZoneQuality {
  freshness: ZoneFreshness;
  testCount: number;
  trendDirection: TrendDirection;
  trendAligned: boolean;
  breakOfStructure: boolean;
  fairValueGap: boolean;
  /** 0-100, based on candle body efficiency and range expansion. */
  impulseStrength: number;
  /** 0-100 composite quality score. */
  score: number;
  grade: ZoneGrade;
}

export interface SupplyDemandZone {
  id: string;
  side: ZoneSide;
  timeframe: MarketTimeframe;
  baseBarIndex: number;
  impulseStartIndex: number;
  impulseEndIndex: number;
  createdAt: TimestampMs;
  /** Body-side edge closest to an expected approach. */
  proximal: number;
  /** Formation wick edge furthest from an expected approach. */
  distal: number;
  lower: number;
  upper: number;
  coordinates: {
    startTime: TimestampMs;
    endTime: TimestampMs;
    priceLow: number;
    priceHigh: number;
  };
  structuralDescription: string;
  quality: ZoneQuality;
}

export interface ZoneDetectionOptions {
  timeframe?: MarketTimeframe;
  minImpulseCandles?: 2 | 3;
  maxImpulseCandles?: 2 | 3;
  minBodyToRangeRatio?: number;
  minRangeAtrMultiple?: number;
  atrPeriod?: number;
  baseLookback?: number;
  trendLookback?: number;
  structureLookback?: number;
  minTrendSlopePerBar?: number;
}

export type ZoneAlertStatus = "outside" | "approaching" | "within" | "crossed";
export type ZoneBoundary = "proximal" | "distal";

export interface ZoneAlertInput {
  zone: SupplyDemandZone;
  currentPrice: number;
  previousPrice?: number;
  /** Percent distance from the nearest zone edge. */
  proximityPercent?: number;
}

export interface ZoneAlertEvaluation {
  zoneId: string;
  side: ZoneSide;
  status: ZoneAlertStatus;
  currentPrice: number;
  distancePoints: number;
  distancePercent: number;
  nearestBoundary: ZoneBoundary;
  crossedBoundary?: ZoneBoundary;
  message: string;
}

export type PressureGroup =
  | "Energy"
  | "Agriculture"
  | "Industrial Metals"
  | "Semiconductors";

/** Every component is normalized to [-1, 1], where positive means demand/tightness. */
export interface SupplyDemandInputs {
  priceMomentum: number;
  volumeImbalance: number;
  orderBookImbalance: number;
  physicalFlowBalance: number;
  inventoryPressure: number;
  logisticsPressure: number;
}

export type SupplyDemandWeights = Record<keyof SupplyDemandInputs, number>;

export type PressureRegime =
  | "strong-demand"
  | "demand"
  | "balanced"
  | "supply"
  | "strong-supply";

export interface SupplyDemandScore {
  /** -100 is maximum supply pressure; +100 is maximum demand pressure. */
  netPressure: number;
  demandScore: number;
  supplyScore: number;
  regime: PressureRegime;
  contributions: SupplyDemandInputs;
}

export interface PressureMarketDefinition {
  id: string;
  label: string;
  symbol: string;
  group: PressureGroup;
  unit: string;
  lastPrice: number;
  changePercent: number;
  inputs: SupplyDemandInputs;
}

export type MarketSessionStatus = "open" | "closed" | "pre-market";

export interface GlobalMarketSnapshot {
  id: string;
  label: string;
  symbol: string;
  region: string;
  latitude: number;
  longitude: number;
  value: number;
  changePercent: number;
  status: MarketSessionStatus;
}

export interface TickerSnapshot {
  symbol: string;
  label: string;
  value: number;
  changePercent: number;
  decimals: number;
}

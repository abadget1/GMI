import type {
  MarketStreamAlert,
  MarketStreamCandle,
  MarketStreamPressure,
  MarketStreamZone,
} from "@/lib/market/market-stream-adapter";
import type { Candle, HeatmapGroup, HeatmapMetric, MarketAlert, PriceZone } from "./types";

const tickerByPressureKey: Readonly<Record<string, string>> = {
  "crude-oil": "WTI",
  "natural-gas": "NG",
  wheat: "WHEAT",
  corn: "CORN",
  copper: "HG",
  aluminum: "ALI",
  memory: "DRAM",
  foundry: "FOUNDRY",
};

function marketTime(timestamp: number, daily: boolean): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(daily ? {} : { hour: "numeric", minute: "2-digit" }),
  }).format(new Date(timestamp));
}

function relativeTime(timestamp: number): string {
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1_000));
  if (elapsedSeconds < 15) return "Just now";
  if (elapsedSeconds < 60) return `${elapsedSeconds}s ago`;
  const minutes = Math.round(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function heatmapGroup(group: string): HeatmapGroup {
  if (group.toLowerCase() === "industrial metals") return "Industrial metals";
  if (group === "Energy" || group === "Agriculture" || group === "Semiconductors") return group;
  return "Semiconductors";
}

export function adaptCandlesForView(candles: readonly MarketStreamCandle[]): Candle[] {
  return candles.map((candle) => ({
    time: marketTime(candle.time, candle.timeframe === "1d"),
    timestamp: candle.time,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

export function adaptZonesForView(zones: readonly MarketStreamZone[]): PriceZone[] {
  return zones.map((zone) => ({
    id: zone.id,
    type: zone.side,
    proximal: zone.proximal,
    distal: zone.distal,
    strength: Math.round(zone.qualityScore),
    tested: zone.freshness === "tested",
    createdAt: marketTime(zone.baseTimestamp, zone.timeframe === "1d"),
    baseTimestamp: zone.baseTimestamp,
    impulseStartTimestamp: zone.impulseStart,
    impulseEndTimestamp: zone.impulseEnd,
    fairValueGap: zone.fairValueGap,
    breakOfStructure: zone.breakOfStructure,
  }));
}

export function adaptPressureForView(
  pressure: readonly MarketStreamPressure[],
): HeatmapMetric[] {
  return pressure.map((metric) => ({
    id: metric.key,
    name: metric.label,
    ticker: tickerByPressureKey[metric.key] ?? metric.key.toUpperCase(),
    group: heatmapGroup(metric.group),
    pressure: metric.score,
    changePercent: (metric.drivers.momentum ?? 0) * 3,
    flowLabel: `${metric.state[0].toUpperCase()}${metric.state.slice(1)} · ${Math.round(metric.confidence * 100)}% confidence`,
  }));
}

export function adaptAlertsForView(
  alerts: readonly MarketStreamAlert[],
  thresholdPercent: number,
): MarketAlert[] {
  return alerts.map((alert) => ({
    id: alert.id,
    symbol: alert.symbol,
    zoneType: alert.side,
    condition:
      alert.mode === "cross" ? "crossed" : alert.mode === "inside" ? "inside" : "approaching",
    thresholdPercent,
    currentDistancePercent: alert.distancePercent,
    triggeredAt: relativeTime(alert.triggeredAt),
  }));
}

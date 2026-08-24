"use client";

import { useMemo, useState } from "react";
import { Box } from "@mui/material";
import CandlestickZoneChart from "./CandlestickZoneChart";
import MarketControlBar from "./MarketControlBar";
import MarketOperations from "./MarketLists";
import SupplyDemandHeatmap from "./SupplyDemandHeatmap";
import TickerTape from "./TickerTape";
import WorldActivityMap from "./WorldActivityMap";
import ZoneRail from "./ZoneRail";
import { demoAlerts, demoCandles, demoHeatmap, demoIndexAssets, demoZones } from "./demoData";
import type {
  ActivityRegion,
  Candle,
  ChartTimeframe,
  HeatmapMetric,
  IndexAssetOption,
  MarketAlert,
  MarketTicker,
  PriceZone,
  WatchlistAsset,
} from "./types";

export interface MarketDashboardContentProps {
  tickers?: MarketTicker[];
  regions?: ActivityRegion[];
  candles?: Candle[];
  zones?: PriceZone[];
  heatmap?: HeatmapMetric[];
  alerts?: MarketAlert[];
  watchlist?: WatchlistAsset[];
  currentValue?: number;
  change?: number;
  changePercent?: number;
  assetOptions?: IndexAssetOption[];
  selectedSymbol?: string;
  symbol?: string;
  indexName?: string;
  alertThreshold?: number;
  timeframe?: ChartTimeframe;
  onAssetChange?: (symbol: string) => void;
  onAlertThresholdChange?: (threshold: number) => void;
  onTimeframeChange?: (timeframe: ChartTimeframe) => void;
  onCreateAlert?: () => void;
  dataQuality?: number;
  latencyMs?: number;
}

export default function MarketDashboardContent({
  tickers,
  regions,
  candles,
  zones,
  heatmap,
  alerts,
  watchlist,
  currentValue,
  change,
  changePercent,
  assetOptions = demoIndexAssets,
  selectedSymbol,
  symbol = "GMI",
  indexName,
  alertThreshold,
  timeframe,
  onAssetChange,
  onAlertThresholdChange,
  onTimeframeChange,
  onCreateAlert,
  dataQuality,
  latencyMs,
}: MarketDashboardContentProps) {
  const [localSymbol, setLocalSymbol] = useState(symbol);
  const [localThreshold, setLocalThreshold] = useState(0.5);
  const activeSymbol = selectedSymbol ?? localSymbol;
  const activeThreshold = alertThreshold ?? localThreshold;
  const activeAsset = assetOptions.find((asset) => asset.symbol === activeSymbol) ?? assetOptions[0] ?? demoIndexAssets[0];
  const liveValue = currentValue ?? activeAsset.value;

  const scaledMarketData = useMemo(() => {
    if (candles && zones) return { candles, zones };
    // A live tick must never rewrite historical candles. Rebase the fixture
    // once for the selected asset, then update only the in-progress last bar.
    const scale = activeAsset.value / demoIndexAssets[0].value;
    const scalePrice = (value: number) => Number((value * scale).toFixed(4));
    let scaledCandles = candles ?? demoCandles.map((candle) => ({
      ...candle,
      open: scalePrice(candle.open),
      high: scalePrice(candle.high),
      low: scalePrice(candle.low),
      close: scalePrice(candle.close),
    }));
    if (!candles && scaledCandles.length) {
      const lastIndex = scaledCandles.length - 1;
      const last = scaledCandles[lastIndex];
      scaledCandles = scaledCandles.map((candle, index) =>
        index === lastIndex
          ? {
              ...last,
              high: Math.max(last.high, liveValue),
              low: Math.min(last.low, liveValue),
              close: liveValue,
            }
          : candle,
      );
    }
    return {
      candles: scaledCandles,
      zones: zones ?? demoZones.map((zone) => ({
        ...zone,
        proximal: scalePrice(zone.proximal),
        distal: scalePrice(zone.distal),
      })),
    };
  }, [activeAsset.value, candles, liveValue, zones]);

  const handleAssetChange = (nextSymbol: string) => {
    if (selectedSymbol === undefined) setLocalSymbol(nextSymbol);
    onAssetChange?.(nextSymbol);
  };

  const handleThresholdChange = (nextThreshold: number) => {
    if (alertThreshold === undefined) setLocalThreshold(nextThreshold);
    onAlertThresholdChange?.(nextThreshold);
  };

  const handleTimeframeChange = (nextTimeframe: string) => {
    const normalized = nextTimeframe.toLowerCase() as ChartTimeframe;
    onTimeframeChange?.(normalized);
  };

  return (
    <Box component="section" aria-label="Global Market Index dashboard" sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <TickerTape items={tickers} />

      <MarketControlBar
        assets={assetOptions}
        selectedSymbol={activeSymbol}
        alertThreshold={activeThreshold}
        onAssetChange={handleAssetChange}
        onAlertThresholdChange={handleThresholdChange}
        dataQuality={dataQuality}
        latencyMs={latencyMs}
      />

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 3.2fr) minmax(250px, 0.88fr)" },
          gap: 2,
          alignItems: "stretch",
        }}
      >
        <CandlestickZoneChart
          candles={scaledMarketData.candles}
          zones={scaledMarketData.zones}
          currentValue={liveValue}
          change={change ?? activeAsset.change}
          changePercent={changePercent ?? activeAsset.changePercent}
          symbol={activeSymbol}
          name={indexName ?? activeAsset.name}
          timeframe={timeframe}
          onTimeframeChange={handleTimeframeChange}
        />
        <ZoneRail
          zones={scaledMarketData.zones}
          currentValue={liveValue}
          symbol={activeSymbol}
          alertThreshold={activeThreshold}
        />
      </Box>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "minmax(0, 1fr)", lg: "minmax(0, 1.18fr) minmax(360px, 0.82fr)" },
          gap: 2,
          alignItems: "stretch",
        }}
      >
        <WorldActivityMap regions={regions} />
        <SupplyDemandHeatmap metrics={heatmap ?? demoHeatmap} />
      </Box>

      <MarketOperations
        alerts={alerts ?? demoAlerts}
        assets={watchlist}
        onCreateAlert={onCreateAlert}
      />
    </Box>
  );
}

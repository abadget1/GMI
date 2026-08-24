"use client";

import { useState } from "react";
import { Box } from "@mui/material";
import CandlestickZoneChart from "./CandlestickZoneChart";
import MarketControlBar from "./MarketControlBar";
import MarketOperations from "./MarketLists";
import SupplyDemandHeatmap from "./SupplyDemandHeatmap";
import TickerTape from "./TickerTape";
import WorldActivityMap from "./WorldActivityMap";
import ZoneRail from "./ZoneRail";
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
  lastUpdated?: string;
  timeframes?: ChartTimeframe[];
  marketStatus?: "live" | "open" | "closed" | "historical";
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
  assetOptions = [],
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
  lastUpdated,
  timeframes,
  marketStatus,
}: MarketDashboardContentProps) {
  const [localSymbol, setLocalSymbol] = useState(symbol);
  const [localThreshold, setLocalThreshold] = useState(0.5);
  const activeSymbol = selectedSymbol ?? localSymbol;
  const activeThreshold = alertThreshold ?? localThreshold;
  const activeAsset = assetOptions.find((asset) => asset.symbol === activeSymbol) ?? assetOptions[0];
  const liveValue = currentValue ?? activeAsset?.value ?? 0;

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
      <TickerTape items={tickers} marketStatus={marketStatus} asOf={lastUpdated} />

      <MarketControlBar
        assets={assetOptions}
        selectedSymbol={activeSymbol}
        alertThreshold={activeThreshold}
        onAssetChange={handleAssetChange}
        onAlertThresholdChange={handleThresholdChange}
        dataQuality={dataQuality}
        latencyMs={latencyMs}
        lastUpdated={lastUpdated}
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
          key={`${activeSymbol}:${timeframe ?? "15m"}`}
          candles={candles ?? []}
          zones={zones ?? []}
          currentValue={liveValue}
          change={change ?? activeAsset?.change ?? 0}
          changePercent={changePercent ?? activeAsset?.changePercent ?? 0}
          symbol={activeSymbol}
          name={indexName ?? activeAsset?.name ?? activeSymbol}
          timeframe={timeframe}
          timeframes={timeframes}
          onTimeframeChange={handleTimeframeChange}
        />
        <ZoneRail
          zones={zones ?? []}
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
        <SupplyDemandHeatmap metrics={heatmap ?? []} />
      </Box>

      <MarketOperations
        alerts={alerts ?? []}
        assets={watchlist}
        onCreateAlert={onCreateAlert}
      />
    </Box>
  );
}

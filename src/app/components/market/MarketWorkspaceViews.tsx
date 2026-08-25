"use client";

import { useId, useMemo, useState } from "react";
import AddAlertRounded from "@mui/icons-material/AddAlertRounded";
import AnalyticsRounded from "@mui/icons-material/AnalyticsRounded";
import AssessmentRounded from "@mui/icons-material/AssessmentRounded";
import BoltRounded from "@mui/icons-material/BoltRounded";
import Inventory2Rounded from "@mui/icons-material/Inventory2Rounded";
import NotificationsActiveRounded from "@mui/icons-material/NotificationsActiveRounded";
import PublicRounded from "@mui/icons-material/PublicRounded";
import ShowChartRounded from "@mui/icons-material/ShowChartRounded";
import TrendingDownRounded from "@mui/icons-material/TrendingDownRounded";
import TrendingUpRounded from "@mui/icons-material/TrendingUpRounded";
import {
  Box,
  Button,
  Chip,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import type { SvgIconComponent } from "@mui/icons-material";
import type {
  MarketAnalyticsPoint,
  MarketAnalyticsSummary,
} from "./analytics";
import CandlestickZoneChart from "./CandlestickZoneChart";
import MarketOperations from "./MarketLists";
import {
  formatMarketValue,
  marketColors,
  MarketPanel,
  StatusDot,
} from "./MarketPanel";
import SupplyDemandHeatmap from "./SupplyDemandHeatmap";
import TickerTape from "./TickerTape";
import WorldActivityMap from "./WorldActivityMap";
import ZoneRail from "./ZoneRail";
import { formatMarketSymbolForDisplay } from "@/lib/market/market-stream-adapter";
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

export const MARKET_WORKSPACE_VIEW_NAMES = [
  "Global markets",
  "Index studio",
  "Supply & demand",
  "Zone analyzer",
  "Alert center",
] as const;

export type MarketWorkspaceViewName = (typeof MARKET_WORKSPACE_VIEW_NAMES)[number];

export interface MarketWorkspaceViewProps {
  candles: Candle[];
  zones: PriceZone[];
  heatmap: HeatmapMetric[];
  analytics: MarketAnalyticsSummary | null;
  analyticsPoints: MarketAnalyticsPoint[];
  regions: ActivityRegion[];
  tickers: MarketTicker[];
  alerts: MarketAlert[];
  watchlist: WatchlistAsset[];
  assetOptions: IndexAssetOption[];
  selectedSymbol: string;
  selectedAssetName?: string;
  timeframe: ChartTimeframe;
  availableTimeframes?: ChartTimeframe[];
  currentValue: number;
  change: number;
  changePercent: number;
  alertThreshold: number;
  dataQuality: number;
  latencyMs: number;
  lastUpdated?: string;
  marketStatus?: "live" | "open" | "closed" | "historical";
  onAssetChange: (symbol: string) => void;
  onTimeframeChange: (timeframe: ChartTimeframe) => void;
  onAlertThresholdChange: (threshold: number) => void;
  onCreateAlert: () => void;
  onOpenAlert?: (alert: MarketAlert) => void;
  onWatchlistAssetSelect?: (asset: WatchlistAsset) => void;
}

export interface MarketWorkspaceDispatcherProps extends MarketWorkspaceViewProps {
  view: MarketWorkspaceViewName;
}

interface EmptyStateProps {
  title: string;
  description: string;
  icon?: SvgIconComponent;
  action?: React.ReactNode;
  minHeight?: number;
}

interface MetricDefinition {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "negative" | "neutral" | "warning";
  progress?: number;
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function safeNumber(value: number | undefined, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function signedPercent(value: number, digits = 2) {
  const finite = safeNumber(value);
  return `${finite > 0 ? "+" : ""}${finite.toFixed(digits)}%`;
}

function compactNumber(value: number) {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function distanceFromZone(currentValue: number, zone: PriceZone) {
  if (!Number.isFinite(currentValue) || currentValue <= 0) return Number.POSITIVE_INFINITY;
  const lower = Math.min(zone.proximal, zone.distal);
  const upper = Math.max(zone.proximal, zone.distal);
  if (currentValue >= lower && currentValue <= upper) return 0;
  const boundary = currentValue < lower ? lower : upper;
  return Math.abs(((boundary - currentValue) / currentValue) * 100);
}

function EmptyState({
  title,
  description,
  icon: Icon = AnalyticsRounded,
  action,
  minHeight = 220,
}: EmptyStateProps) {
  return (
    <MarketPanel sx={{ height: "100%" }}>
      <Stack
        role="status"
        alignItems="center"
        justifyContent="center"
        spacing={1.2}
        sx={{ minHeight, px: 3, py: 4, textAlign: "center" }}
      >
        <Box
          sx={{
            width: 43,
            height: 43,
            display: "grid",
            placeItems: "center",
            color: marketColors.cyan,
            bgcolor: marketColors.cyanSoft,
            border: "1px solid rgba(36,185,243,0.26)",
            borderRadius: "13px",
          }}
        >
          <Icon sx={{ fontSize: 22 }} />
        </Box>
        <Typography sx={{ fontSize: "0.82rem", fontWeight: 850 }}>{title}</Typography>
        <Typography sx={{ maxWidth: 440, color: marketColors.muted, fontSize: "0.64rem", lineHeight: 1.65 }}>
          {description}
        </Typography>
        {action}
      </Stack>
    </MarketPanel>
  );
}

function ViewIntro({
  id,
  eyebrow,
  title,
  description,
  icon: Icon,
  action,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: SvgIconComponent;
  action?: React.ReactNode;
}) {
  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      alignItems={{ xs: "flex-start", sm: "center" }}
      justifyContent="space-between"
      spacing={1.5}
      sx={{ px: 0.4 }}
    >
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <Box
          sx={{
            width: 42,
            height: 42,
            display: "grid",
            placeItems: "center",
            flex: "0 0 auto",
            color: marketColors.cyan,
            bgcolor: marketColors.cyanSoft,
            border: "1px solid rgba(36,185,243,0.25)",
            borderRadius: "13px",
          }}
        >
          <Icon sx={{ fontSize: 21 }} />
        </Box>
        <Box>
          <Typography
            sx={{
              color: marketColors.cyan,
              fontSize: "0.54rem",
              fontWeight: 850,
              letterSpacing: "0.13em",
              textTransform: "uppercase",
            }}
          >
            {eyebrow}
          </Typography>
          <Typography id={id} component="h1" sx={{ mt: 0.35, fontSize: { xs: "1.15rem", sm: "1.35rem" }, fontWeight: 820, letterSpacing: "-0.035em" }}>
            {title}
          </Typography>
          <Typography sx={{ mt: 0.4, maxWidth: 720, color: marketColors.muted, fontSize: "0.64rem", lineHeight: 1.55 }}>
            {description}
          </Typography>
        </Box>
      </Stack>
      {action}
    </Stack>
  );
}

function MetricCards({ metrics }: { metrics: MetricDefinition[] }) {
  const toneColor = {
    positive: marketColors.demand,
    negative: marketColors.supply,
    neutral: marketColors.cyan,
    warning: marketColors.warning,
  };
  return (
    <Box
      component="dl"
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "repeat(2, minmax(0, 1fr))", lg: `repeat(${Math.min(metrics.length, 4)}, minmax(0, 1fr))` },
        gap: 1.2,
        m: 0,
      }}
    >
      {metrics.map((metric) => {
        const accent = toneColor[metric.tone ?? "neutral"];
        return (
          <Box
            key={metric.label}
            sx={{
              minWidth: 0,
              p: { xs: 1.45, sm: 1.7 },
              bgcolor: marketColors.panel,
              border: `1px solid ${marketColors.line}`,
              borderRadius: "15px",
            }}
          >
            <Typography component="dt" sx={{ color: marketColors.muted, fontSize: "0.54rem", fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {metric.label}
            </Typography>
            <Typography component="dd" sx={{ m: 0, mt: 0.65, color: accent, fontSize: { xs: "1rem", sm: "1.18rem" }, fontWeight: 850, letterSpacing: "-0.035em" }}>
              {metric.value}
            </Typography>
            <Typography sx={{ mt: 0.4, color: marketColors.muted, fontSize: "0.54rem", lineHeight: 1.45 }}>
              {metric.detail}
            </Typography>
            {typeof metric.progress === "number" && (
              <LinearProgress
                variant="determinate"
                value={clamp(metric.progress)}
                aria-label={`${metric.label}: ${Math.round(clamp(metric.progress))} percent`}
                sx={{ mt: 1, height: 3, bgcolor: "rgba(255,255,255,0.07)", borderRadius: 4, "& .MuiLinearProgress-bar": { bgcolor: accent } }}
              />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

interface PerformanceDatum {
  label: string;
  returnPercent: number;
  volume: number;
}

function performanceData(candles: Candle[], points: MarketAnalyticsPoint[]): PerformanceDatum[] {
  if (points.length) {
    return points.map((point, index) => ({
      label: point.time || candles[index]?.time || `Bar ${index + 1}`,
      returnPercent: safeNumber(point.cumulativeReturnPercent),
      volume: safeNumber(point.volume),
    }));
  }
  const base = candles[0]?.close;
  if (!base || !Number.isFinite(base)) return [];
  return candles.map((candle) => ({
    label: candle.time,
    returnPercent: ((candle.close / base) - 1) * 100,
    volume: safeNumber(candle.volume),
  }));
}

function PerformanceVolumeChart({
  candles,
  points,
  symbol,
}: {
  candles: Candle[];
  points: MarketAnalyticsPoint[];
  symbol: string;
}) {
  const rawId = useId().replace(/:/g, "");
  const displaySymbol = formatMarketSymbolForDisplay(symbol);
  const series = useMemo(() => performanceData(candles, points).slice(-120), [candles, points]);
  if (series.length < 2) {
    return (
      <EmptyState
        title="Performance series unavailable"
        description="Import at least two valid OHLCV bars to calculate synchronized return and volume history."
        icon={ShowChartRounded}
        minHeight={310}
      />
    );
  }

  const width = 900;
  const height = 350;
  const left = 54;
  const right = 24;
  const top = 24;
  const priceBottom = 236;
  const volumeTop = 267;
  const volumeBottom = 326;
  const plotWidth = width - left - right;
  const returns = series.map((point) => point.returnPercent);
  const rawMin = Math.min(0, ...returns);
  const rawMax = Math.max(0, ...returns);
  const returnPad = Math.max((rawMax - rawMin) * 0.12, 0.1);
  const minimum = rawMin - returnPad;
  const maximum = rawMax + returnPad;
  const returnRange = maximum - minimum || 1;
  const maxVolume = Math.max(1, ...series.map((point) => point.volume));
  const x = (index: number) => left + (index / Math.max(series.length - 1, 1)) * plotWidth;
  const y = (value: number) => top + ((maximum - value) / returnRange) * (priceBottom - top);
  const zeroY = y(0);
  const line = series.map((point, index) => `${x(index)},${y(point.returnPercent)}`).join(" ");
  const area = `${left},${zeroY} ${line} ${x(series.length - 1)},${zeroY}`;
  const finalReturn = series.at(-1)?.returnPercent ?? 0;
  const accent = finalReturn >= 0 ? marketColors.demand : marketColors.supply;
  const gradientId = `${rawId}-performance-fill`;
  const titleId = `${rawId}-performance-title`;
  const descriptionId = `${rawId}-performance-description`;
  const yTicks = Array.from({ length: 5 }, (_, index) => maximum - (returnRange * index) / 4);

  return (
    <MarketPanel
      title={`${displaySymbol} performance & volume`}
      eyebrow="Synchronized history"
      action={<Chip label={`${series.length} bars`} size="small" sx={{ height: 24, color: accent, bgcolor: `${accent}16`, fontSize: "0.56rem", fontWeight: 800 }} />}
      contentSx={{ px: { xs: 1, sm: 2 }, pb: 1.5 }}
      sx={{ height: "100%" }}
    >
      <Box sx={{ overflowX: "auto" }}>
        <Box
          component="svg"
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
          sx={{ display: "block", width: "100%", minWidth: 620, height: "auto" }}
        >
          <title id={titleId}>{displaySymbol} cumulative performance and volume</title>
          <desc id={descriptionId}>Cumulative return line aligned with volume bars across {series.length} uploaded market bars.</desc>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={accent} stopOpacity="0.28" />
              <stop offset="100%" stopColor={accent} stopOpacity="0" />
            </linearGradient>
          </defs>
          {yTicks.map((tick) => (
            <g key={tick}>
              <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} stroke="rgba(137,170,200,0.12)" strokeDasharray="3 7" />
              <text x={left - 8} y={y(tick) + 3} textAnchor="end" fill={marketColors.muted} fontSize="10">
                {signedPercent(tick, 1)}
              </text>
            </g>
          ))}
          <line x1={left} x2={width - right} y1={zeroY} y2={zeroY} stroke="rgba(244,248,252,0.28)" />
          <polygon points={area} fill={`url(#${gradientId})`} />
          <polyline points={line} fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={x(series.length - 1)} cy={y(finalReturn)} r="4" fill={accent} stroke={marketColors.panel} strokeWidth="2" />
          {series.map((point, index) => {
            const barWidth = Math.max(2, Math.min(9, plotWidth / series.length - 1));
            const barHeight = (point.volume / maxVolume) * (volumeBottom - volumeTop);
            return (
              <rect
                key={`${point.label}-${index}`}
                x={x(index) - barWidth / 2}
                y={volumeBottom - barHeight}
                width={barWidth}
                height={barHeight}
                rx="1"
                fill={index === series.length - 1 ? accent : "rgba(79,139,180,0.42)"}
              />
            );
          })}
          <text x={left} y={volumeTop - 8} fill={marketColors.muted} fontSize="10" fontWeight="700">VOLUME</text>
          <text x={left} y={height - 5} fill={marketColors.muted} fontSize="10">{series[0].label}</text>
          <text x={width - right} y={height - 5} textAnchor="end" fill={marketColors.muted} fontSize="10">{series.at(-1)?.label}</text>
        </Box>
      </Box>
    </MarketPanel>
  );
}

function ReturnDistributionChart({
  points,
  candles,
}: {
  points: MarketAnalyticsPoint[];
  candles: Candle[];
}) {
  const rawId = useId().replace(/:/g, "");
  const returns = useMemo(() => {
    if (points.length > 1) return points.slice(1).map((point) => safeNumber(point.returnPercent));
    return candles.slice(1).map((candle, index) => {
      const previous = candles[index]?.close;
      return previous ? ((candle.close / previous) - 1) * 100 : 0;
    });
  }, [candles, points]);
  if (!returns.length) {
    return (
      <EmptyState
        title="Return distribution unavailable"
        description="At least two synchronized closing prices are required to build the return histogram."
        icon={AssessmentRounded}
        minHeight={310}
      />
    );
  }

  const bucketCount = Math.min(11, Math.max(5, Math.round(Math.sqrt(returns.length))));
  const minimum = Math.min(...returns);
  const maximum = Math.max(...returns);
  const span = maximum - minimum || 1;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    low: minimum + (span * index) / bucketCount,
    high: minimum + (span * (index + 1)) / bucketCount,
    count: 0,
  }));
  returns.forEach((value) => {
    const bucketIndex = Math.min(bucketCount - 1, Math.floor(((value - minimum) / span) * bucketCount));
    buckets[bucketIndex].count += 1;
  });
  const width = 620;
  const height = 310;
  const left = 38;
  const right = 18;
  const top = 28;
  const bottom = 46;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const slot = plotWidth / buckets.length;
  const titleId = `${rawId}-distribution-title`;
  const descriptionId = `${rawId}-distribution-description`;

  return (
    <MarketPanel title="Return distribution" eyebrow="Bar-level behavior" sx={{ height: "100%" }} contentSx={{ px: 1.5, pb: 1.5 }}>
      <Box
        component="svg"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-labelledby={`${titleId} ${descriptionId}`}
        sx={{ display: "block", width: "100%", height: "auto" }}
      >
        <title id={titleId}>Distribution of synchronized bar returns</title>
        <desc id={descriptionId}>Histogram showing how frequently returns fell into each percentage interval.</desc>
        {[0, 0.5, 1].map((ratio) => (
          <g key={ratio}>
            <line x1={left} x2={width - right} y1={top + plotHeight * ratio} y2={top + plotHeight * ratio} stroke="rgba(137,170,200,0.12)" strokeDasharray="3 7" />
            <text x={left - 7} y={top + plotHeight * ratio + 3} textAnchor="end" fill={marketColors.muted} fontSize="9">
              {Math.round(maxCount * (1 - ratio))}
            </text>
          </g>
        ))}
        {buckets.map((bucket, index) => {
          const middle = (bucket.low + bucket.high) / 2;
          const accent = middle >= 0 ? marketColors.demand : marketColors.supply;
          const barHeight = (bucket.count / maxCount) * plotHeight;
          return (
            <g key={`${bucket.low}-${bucket.high}`}>
              <rect
                x={left + index * slot + 2}
                y={top + plotHeight - barHeight}
                width={Math.max(2, slot - 4)}
                height={barHeight}
                rx="3"
                fill={accent}
                opacity="0.72"
              />
              {(index === 0 || index === buckets.length - 1 || index === Math.floor(buckets.length / 2)) && (
                <text x={left + index * slot + slot / 2} y={height - 20} textAnchor="middle" fill={marketColors.muted} fontSize="9">
                  {signedPercent(middle, 1)}
                </text>
              )}
            </g>
          );
        })}
        <text x={left + plotWidth / 2} y={height - 3} textAnchor="middle" fill={marketColors.muted} fontSize="9" fontWeight="700">BAR RETURN</text>
      </Box>
    </MarketPanel>
  );
}

function ZoneInventory({
  zones,
  currentValue,
  selectedZoneId,
  onSelect,
  title = "Zone inventory",
}: {
  zones: PriceZone[];
  currentValue: number;
  selectedZoneId?: string | null;
  onSelect?: (zone: PriceZone) => void;
  title?: string;
}) {
  const ordered = useMemo(
    () => [...zones].sort((left, right) => distanceFromZone(currentValue, left) - distanceFromZone(currentValue, right)),
    [currentValue, zones],
  );
  if (!ordered.length) {
    return (
      <EmptyState
        title="No structural zones detected"
        description="The selected history has not produced a qualifying supply or demand structure for this timeframe."
        icon={Inventory2Rounded}
        minHeight={260}
      />
    );
  }

  return (
    <MarketPanel
      title={title}
      eyebrow="Nearest first"
      action={<Chip label={`${ordered.length} detected`} size="small" sx={{ height: 24, color: marketColors.cyan, bgcolor: marketColors.cyanSoft, fontSize: "0.56rem", fontWeight: 800 }} />}
      contentSx={{ px: 1.5, pb: 1.5 }}
      sx={{ height: "100%" }}
    >
      <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: "none", maxHeight: 480, overflowY: "auto" }}>
        {ordered.map((zone) => {
          const accent = zone.type === "demand" ? marketColors.demand : marketColors.supply;
          const lower = Math.min(zone.proximal, zone.distal);
          const upper = Math.max(zone.proximal, zone.distal);
          const distance = distanceFromZone(currentValue, zone);
          const selected = zone.id === selectedZoneId;
          return (
            <Box component="li" key={zone.id}>
              <Box
                component={onSelect ? "button" : "div"}
                type={onSelect ? "button" : undefined}
                onClick={() => onSelect?.(zone)}
                aria-pressed={onSelect ? selected : undefined}
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr auto", sm: "minmax(96px, 0.7fr) minmax(150px, 1.25fr) repeat(2, minmax(70px, 0.55fr))" },
                  alignItems: "center",
                  gap: 1,
                  width: "100%",
                  px: 1.25,
                  py: 1.1,
                  color: marketColors.text,
                  textAlign: "left",
                  font: "inherit",
                  bgcolor: selected ? `${accent}13` : "rgba(255,255,255,0.022)",
                  border: `1px solid ${selected ? `${accent}65` : marketColors.line}`,
                  borderRadius: "11px",
                  cursor: onSelect ? "pointer" : "default",
                  transition: "border-color 150ms ease, background-color 150ms ease",
                  "&:hover": onSelect ? { borderColor: `${accent}65`, bgcolor: `${accent}0D` } : undefined,
                  "&:focus-visible": { outline: `2px solid ${marketColors.cyan}`, outlineOffset: 2 },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <StatusDot color={accent} />
                  <Box>
                    <Typography sx={{ fontSize: "0.61rem", fontWeight: 850, textTransform: "uppercase" }}>{zone.type}</Typography>
                    <Typography sx={{ mt: 0.2, color: marketColors.muted, fontSize: "0.49rem" }}>{zone.tested ? "Tested" : "Virgin"}</Typography>
                  </Box>
                </Stack>
                <Box>
                  <Typography sx={{ fontSize: "0.65rem", fontWeight: 800 }}>{formatMarketValue(lower)} – {formatMarketValue(upper)}</Typography>
                  <Typography noWrap sx={{ mt: 0.2, color: marketColors.muted, fontSize: "0.5rem" }}>{zone.createdAt}</Typography>
                </Box>
                <Box sx={{ display: { xs: "none", sm: "block" } }}>
                  <Typography sx={{ color: marketColors.muted, fontSize: "0.49rem" }}>Quality</Typography>
                  <Typography sx={{ mt: 0.2, color: accent, fontSize: "0.61rem", fontWeight: 800 }}>{zone.strength}/100</Typography>
                </Box>
                <Box sx={{ textAlign: "right" }}>
                  <Typography sx={{ color: marketColors.muted, fontSize: "0.49rem" }}>Distance</Typography>
                  <Typography sx={{ mt: 0.2, color: distance === 0 ? marketColors.warning : accent, fontSize: "0.61rem", fontWeight: 850 }}>
                    {distance === 0 ? "Inside" : `${distance.toFixed(2)}%`}
                  </Typography>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Stack>
    </MarketPanel>
  );
}

function ZoneDetails({ zone, currentValue }: { zone?: PriceZone; currentValue: number }) {
  if (!zone) {
    return (
      <EmptyState
        title="Select a zone to inspect"
        description="Choose a detected supply or demand zone to review its structure, freshness, and distance."
        icon={AssessmentRounded}
        minHeight={310}
      />
    );
  }
  const accent = zone.type === "demand" ? marketColors.demand : marketColors.supply;
  const lower = Math.min(zone.proximal, zone.distal);
  const upper = Math.max(zone.proximal, zone.distal);
  const distance = distanceFromZone(currentValue, zone);
  return (
    <MarketPanel
      title={`${zone.type === "demand" ? "Demand" : "Supply"} structure`}
      eyebrow="Selected zone"
      action={<Chip label={zone.tested ? "Tested" : "Virgin"} size="small" sx={{ height: 24, color: accent, bgcolor: `${accent}16`, fontSize: "0.56rem", fontWeight: 850 }} />}
      contentSx={{ px: 2, pb: 2 }}
      sx={{ height: "100%" }}
    >
      <Stack spacing={1.1}>
        {[
          ["Upper bound", formatMarketValue(upper)],
          ["Lower bound", formatMarketValue(lower)],
          ["Zone width", `${Math.abs(((upper - lower) / Math.max(lower, 0.000001)) * 100).toFixed(2)}%`],
          ["Current distance", distance === 0 ? "Price is inside" : `${distance.toFixed(2)}% away`],
          ["Created", zone.createdAt],
        ].map(([label, value]) => (
          <Stack key={label} direction="row" alignItems="center" justifyContent="space-between" spacing={2} sx={{ px: 1.15, py: 0.9, bgcolor: "rgba(255,255,255,0.025)", border: `1px solid ${marketColors.line}`, borderRadius: "9px" }}>
            <Typography sx={{ color: marketColors.muted, fontSize: "0.55rem" }}>{label}</Typography>
            <Typography sx={{ fontSize: "0.61rem", fontWeight: 800, textAlign: "right" }}>{value}</Typography>
          </Stack>
        ))}
        <Box sx={{ pt: 0.5 }}>
          <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.65 }}>
            <Typography sx={{ color: marketColors.muted, fontSize: "0.54rem" }}>Structural quality</Typography>
            <Typography sx={{ color: accent, fontSize: "0.58rem", fontWeight: 850 }}>{zone.strength}/100</Typography>
          </Stack>
          <LinearProgress variant="determinate" value={clamp(zone.strength)} sx={{ height: 5, bgcolor: "rgba(255,255,255,0.07)", borderRadius: 4, "& .MuiLinearProgress-bar": { bgcolor: accent } }} />
        </Box>
        <Stack direction="row" flexWrap="wrap" gap={0.65} sx={{ pt: 0.5 }}>
          <Chip label={zone.fairValueGap ? "Fair value gap" : "No FVG"} size="small" sx={{ height: 23, color: zone.fairValueGap ? marketColors.demand : marketColors.muted, bgcolor: zone.fairValueGap ? marketColors.demandSoft : "rgba(255,255,255,0.04)", fontSize: "0.53rem" }} />
          <Chip label={zone.breakOfStructure ? "Break of structure" : "No BOS"} size="small" sx={{ height: 23, color: zone.breakOfStructure ? marketColors.cyan : marketColors.muted, bgcolor: zone.breakOfStructure ? marketColors.cyanSoft : "rgba(255,255,255,0.04)", fontSize: "0.53rem" }} />
        </Stack>
      </Stack>
    </MarketPanel>
  );
}

function AlertSummary({ alerts }: { alerts: MarketAlert[] }) {
  const armed = alerts.filter((alert) => alert.armed).length;
  const inside = alerts.filter((alert) => alert.condition === "inside").length;
  const crossed = alerts.filter((alert) => alert.condition === "crossed").length;
  const nearest = alerts.reduce<number | undefined>((closest, alert) => {
    const distance = Math.abs(alert.currentDistancePercent);
    return closest === undefined || distance < closest ? distance : closest;
  }, undefined);
  return (
    <MetricCards
      metrics={[
        { label: "Armed rules", value: armed.toLocaleString(), detail: "Monitoring live zone proximity", tone: armed ? "positive" : "neutral" },
        { label: "Inside zone", value: inside.toLocaleString(), detail: "Active zone-entry conditions", tone: inside ? "warning" : "neutral" },
        { label: "Crossings", value: crossed.toLocaleString(), detail: "Boundary events in the feed", tone: crossed ? "negative" : "neutral" },
        { label: "Nearest trigger", value: nearest === undefined ? "—" : `${nearest.toFixed(2)}%`, detail: nearest === undefined ? "No alert distance available" : "Absolute distance to threshold", tone: "neutral" },
      ]}
    />
  );
}

function AlertLedger({
  alerts,
  onCreateAlert,
  onOpenAlert,
}: {
  alerts: MarketAlert[];
  onCreateAlert: () => void;
  onOpenAlert?: (alert: MarketAlert) => void;
}) {
  if (!alerts.length) {
    return (
      <EmptyState
        title="No alert rules or events"
        description="Create a threshold rule to monitor approach, entry, and boundary-crossing events for the selected asset."
        icon={NotificationsActiveRounded}
        action={<Button startIcon={<AddAlertRounded />} onClick={onCreateAlert} sx={{ mt: 0.5, color: marketColors.ink, bgcolor: marketColors.cyan, fontSize: "0.61rem", fontWeight: 850, textTransform: "none", "&:hover": { bgcolor: "#69dfff" } }}>Create first alert</Button>}
        minHeight={310}
      />
    );
  }
  return (
    <MarketPanel
      title="Alert rule ledger"
      eyebrow="Live monitoring"
      action={<Button startIcon={<AddAlertRounded />} onClick={onCreateAlert} sx={{ height: 30, color: marketColors.ink, bgcolor: marketColors.cyan, fontSize: "0.57rem", fontWeight: 850, textTransform: "none", "&:hover": { bgcolor: "#69dfff" } }}>New alert</Button>}
      contentSx={{ px: 1.5, pb: 1.5 }}
    >
      <Stack component="ul" spacing={0.75} sx={{ m: 0, p: 0, listStyle: "none" }}>
        {alerts.map((alert) => {
          const accent = alert.zoneType === "demand" ? marketColors.demand : marketColors.supply;
          return (
            <Box component="li" key={alert.id}>
              <Box
                component="button"
                type="button"
                onClick={() => onOpenAlert?.(alert)}
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr auto", md: "minmax(110px, 0.7fr) minmax(150px, 1fr) repeat(2, minmax(85px, 0.6fr))" },
                  alignItems: "center",
                  gap: 1,
                  width: "100%",
                  px: 1.25,
                  py: 1.05,
                  color: marketColors.text,
                  textAlign: "left",
                  font: "inherit",
                  bgcolor: "rgba(255,255,255,0.022)",
                  border: `1px solid ${marketColors.line}`,
                  borderRadius: "11px",
                  cursor: onOpenAlert ? "pointer" : "default",
                  "&:hover": { borderColor: `${accent}55`, bgcolor: `${accent}09` },
                  "&:focus-visible": { outline: `2px solid ${marketColors.cyan}`, outlineOffset: 2 },
                }}
              >
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <StatusDot color={accent} />
                  <Box>
                    <Typography sx={{ fontSize: "0.65rem", fontWeight: 850 }}>{formatMarketSymbolForDisplay(alert.symbol)}</Typography>
                    <Typography sx={{ mt: 0.2, color: marketColors.muted, fontSize: "0.49rem", textTransform: "capitalize" }}>{alert.zoneType} zone</Typography>
                  </Box>
                </Stack>
                <Box>
                  <Typography sx={{ fontSize: "0.59rem", fontWeight: 750, textTransform: "capitalize" }}>{alert.condition.replace("ed", "")}</Typography>
                  <Typography sx={{ mt: 0.2, color: marketColors.muted, fontSize: "0.49rem" }}>{alert.triggeredAt}</Typography>
                </Box>
                <Box sx={{ display: { xs: "none", md: "block" } }}>
                  <Typography sx={{ color: marketColors.muted, fontSize: "0.49rem" }}>Threshold</Typography>
                  <Typography sx={{ mt: 0.2, fontSize: "0.59rem", fontWeight: 800 }}>±{alert.thresholdPercent.toFixed(1)}%</Typography>
                </Box>
                <Box sx={{ textAlign: "right" }}>
                  <Typography sx={{ color: marketColors.muted, fontSize: "0.49rem" }}>Distance</Typography>
                  <Typography sx={{ mt: 0.2, color: accent, fontSize: "0.61rem", fontWeight: 850 }}>{Math.abs(alert.currentDistancePercent).toFixed(2)}%</Typography>
                </Box>
              </Box>
            </Box>
          );
        })}
      </Stack>
    </MarketPanel>
  );
}

function WatchlistContext({
  watchlist,
  onSelect,
}: {
  watchlist: WatchlistAsset[];
  onSelect?: (asset: WatchlistAsset) => void;
}) {
  if (!watchlist.length) {
    return (
      <EmptyState
        title="No synchronized watchlist"
        description="Watchlist context will appear when assets can be derived from the active imported history."
        icon={PublicRounded}
        minHeight={310}
      />
    );
  }
  return (
    <MarketPanel title="Alert context" eyebrow="Synchronized watchlist" contentSx={{ px: 1.5, pb: 1.5 }} sx={{ height: "100%" }}>
      <Stack spacing={0.75}>
        {watchlist.map((asset) => {
          const accent = asset.zoneState === "near demand" ? marketColors.demand : asset.zoneState === "near supply" ? marketColors.supply : marketColors.cyan;
          return (
            <Box
              key={asset.symbol}
              component="button"
              type="button"
              onClick={() => onSelect?.(asset)}
              sx={{ display: "flex", alignItems: "center", gap: 1, width: "100%", px: 1.15, py: 1, color: marketColors.text, textAlign: "left", font: "inherit", bgcolor: "rgba(255,255,255,0.022)", border: `1px solid ${marketColors.line}`, borderRadius: "10px", cursor: onSelect ? "pointer" : "default", "&:hover": { borderColor: `${accent}55` }, "&:focus-visible": { outline: `2px solid ${marketColors.cyan}`, outlineOffset: 2 } }}
            >
              <StatusDot color={accent} />
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Typography sx={{ fontSize: "0.62rem", fontWeight: 850 }}>{formatMarketSymbolForDisplay(asset.symbol)}</Typography>
                <Typography noWrap sx={{ mt: 0.2, color: marketColors.muted, fontSize: "0.49rem" }}>{asset.name}</Typography>
              </Box>
              <Box sx={{ textAlign: "right" }}>
                <Typography sx={{ fontSize: "0.62rem", fontWeight: 800 }}>{formatMarketValue(asset.value)}</Typography>
                <Typography sx={{ mt: 0.2, color: asset.changePercent >= 0 ? marketColors.demand : marketColors.supply, fontSize: "0.51rem", fontWeight: 800 }}>{signedPercent(asset.changePercent)}</Typography>
              </Box>
            </Box>
          );
        })}
      </Stack>
    </MarketPanel>
  );
}

function chartProps(props: MarketWorkspaceViewProps) {
  return {
    candles: props.candles,
    zones: props.zones,
    symbol: props.selectedSymbol,
    name: props.selectedAssetName,
    currentValue: props.currentValue,
    change: props.change,
    changePercent: props.changePercent,
    timeframe: props.timeframe,
    timeframes: props.availableTimeframes,
    onTimeframeChange: (next: string) => props.onTimeframeChange(next.toLowerCase() as ChartTimeframe),
  };
}

function summaryMetrics(analytics: MarketAnalyticsSummary | null): MetricDefinition[] {
  if (!analytics) {
    return [
      { label: "Total return", value: "—", detail: "Awaiting synchronized history", tone: "neutral" },
      { label: "Realized volatility", value: "—", detail: "Awaiting synchronized history", tone: "neutral" },
      { label: "Maximum drawdown", value: "—", detail: "Awaiting synchronized history", tone: "neutral" },
      { label: "Bullish bars", value: "—", detail: "Awaiting synchronized history", tone: "neutral" },
    ];
  }
  return [
    {
      label: "Total return",
      value: signedPercent(analytics.changePercent),
      detail: `${formatMarketValue(analytics.startValue)} → ${formatMarketValue(analytics.endValue)}`,
      tone: analytics.changePercent >= 0 ? "positive" : "negative",
    },
    {
      label: "Realized volatility",
      value: `${safeNumber(analytics.realizedVolatilityPercent).toFixed(2)}%`,
      detail: `${analytics.bars.toLocaleString()} ${analytics.timeframe.toUpperCase()} bars`,
      tone: "warning",
    },
    {
      label: "Maximum drawdown",
      value: `-${Math.abs(safeNumber(analytics.maxDrawdownPercent)).toFixed(2)}%`,
      detail: `Range ${safeNumber(analytics.rangePercent).toFixed(2)}%`,
      tone: "negative",
    },
    {
      label: "Bullish bars",
      value: `${safeNumber(analytics.bullishRatio).toFixed(1)}%`,
      detail: `Average volume ${compactNumber(safeNumber(analytics.averageVolume))}`,
      tone: analytics.bullishRatio >= 50 ? "positive" : "negative",
      progress: analytics.bullishRatio,
    },
  ];
}

export function GlobalMarketsView(props: MarketWorkspaceViewProps) {
  const headingId = "global-markets-view-title";
  return (
    <Stack component="section" aria-labelledby={headingId} spacing={2}>
      <ViewIntro
        id={headingId}
        eyebrow="Cross-market pulse"
        title="Global markets"
        description="Regional activity, synchronized performance, physical-flow pressure, and live watch context from the active dataset."
        icon={PublicRounded}
        action={<Chip icon={<StatusDot color={marketColors.demand} />} label={`${props.latencyMs}ms feed`} size="small" sx={{ height: 27, color: marketColors.muted, bgcolor: "rgba(255,255,255,0.04)", fontSize: "0.55rem", "& .MuiChip-icon": { ml: 1 } }} />}
      />
      {props.tickers.length ? (
        <TickerTape items={props.tickers} marketStatus={props.marketStatus} asOf={props.lastUpdated ?? `${props.timeframe.toUpperCase()} synchronized`} />
      ) : (
        <EmptyState title="No market ticker data" description="Ticker values will appear after a valid market dataset is selected." icon={PublicRounded} minHeight={150} />
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 0.95fr) minmax(0, 1.25fr)" }, gap: 2, alignItems: "stretch" }}>
        {props.regions.length ? (
          <WorldActivityMap regions={props.regions} title="Dataset activity map" />
        ) : (
          <EmptyState title="No regional activity" description="The current history does not contain enough temporal coverage to infer synchronized market hubs." icon={PublicRounded} minHeight={380} />
        )}
        <PerformanceVolumeChart candles={props.candles} points={props.analyticsPoints} symbol={props.selectedSymbol} />
      </Box>
      {props.heatmap.length ? (
        <SupplyDemandHeatmap metrics={props.heatmap} title="Cross-market supply & demand" />
      ) : (
        <EmptyState title="No pressure metrics" description="Supply and demand pressure requires enough uploaded bars to calculate momentum, flow, and structural context." icon={BoltRounded} minHeight={260} />
      )}
      {props.alerts.length && props.watchlist.length ? (
        <MarketOperations
          alerts={props.alerts}
          assets={props.watchlist}
          onCreateAlert={props.onCreateAlert}
          onOpenAlert={props.onOpenAlert}
          onAssetSelect={props.onWatchlistAssetSelect}
        />
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.3fr) minmax(270px, 0.7fr)" }, gap: 2 }}>
          <AlertLedger alerts={props.alerts} onCreateAlert={props.onCreateAlert} onOpenAlert={props.onOpenAlert} />
          <WatchlistContext watchlist={props.watchlist} onSelect={props.onWatchlistAssetSelect} />
        </Box>
      )}
    </Stack>
  );
}

export function IndexStudioView(props: MarketWorkspaceViewProps) {
  const headingId = "index-studio-view-title";
  return (
    <Stack component="section" aria-labelledby={headingId} spacing={2}>
      <ViewIntro
        id={headingId}
        eyebrow="Quant workbench"
        title="Index studio"
        description="Inspect construction, return behavior, drawdown, volatility, and volume for the active symbol and timeframe."
        icon={ShowChartRounded}
      />
      <MetricCards metrics={summaryMetrics(props.analytics)} />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1.55fr) minmax(330px, 0.75fr)" }, gap: 2, alignItems: "stretch" }}>
        {props.candles.length ? (
          <CandlestickZoneChart key={`${props.selectedSymbol}:${props.timeframe}`} {...chartProps(props)} />
        ) : (
          <EmptyState title="No indexed price history" description="The selected asset and timeframe contain no synchronized OHLCV bars." icon={ShowChartRounded} minHeight={430} />
        )}
        <ReturnDistributionChart points={props.analyticsPoints} candles={props.candles} />
      </Box>
      <PerformanceVolumeChart candles={props.candles} points={props.analyticsPoints} symbol={props.selectedSymbol} />
    </Stack>
  );
}

export function SupplyDemandView(props: MarketWorkspaceViewProps) {
  const headingId = "supply-demand-view-title";
  const demandCount = props.zones.filter((zone) => zone.type === "demand").length;
  const supplyCount = props.zones.filter((zone) => zone.type === "supply").length;
  const virginCount = props.zones.filter((zone) => !zone.tested).length;
  const netPressure = props.heatmap.length
    ? props.heatmap.reduce((total, metric) => total + metric.pressure, 0) / props.heatmap.length
    : 0;
  return (
    <Stack component="section" aria-labelledby={headingId} spacing={2}>
      <ViewIntro
        id={headingId}
        eyebrow="Structural balance"
        title="Supply & demand"
        description="Compare derived pressure with price structure, active zones, freshness, and proximity on one synchronized canvas."
        icon={Inventory2Rounded}
      />
      <MetricCards
        metrics={[
          { label: "Demand zones", value: demandCount.toLocaleString(), detail: "Qualifying support structures", tone: "positive" },
          { label: "Supply zones", value: supplyCount.toLocaleString(), detail: "Qualifying resistance structures", tone: "negative" },
          { label: "Virgin zones", value: virginCount.toLocaleString(), detail: "Structures without a retest", tone: virginCount ? "positive" : "neutral" },
          { label: "Net pressure", value: signedPercent(netPressure, 0), detail: `${props.heatmap.length} synchronized metrics`, tone: netPressure >= 0 ? "positive" : "negative" },
        ]}
      />
      {props.heatmap.length ? (
        <SupplyDemandHeatmap metrics={props.heatmap} title={`${props.selectedSymbol} pressure matrix`} />
      ) : (
        <EmptyState title="No pressure matrix" description="The selected dataset needs additional bars before a reliable pressure matrix can be derived." icon={BoltRounded} minHeight={270} />
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.55fr) minmax(280px, 0.62fr)" }, gap: 2, alignItems: "stretch" }}>
        {props.candles.length ? (
          <CandlestickZoneChart key={`${props.selectedSymbol}:${props.timeframe}`} {...chartProps(props)} />
        ) : (
          <EmptyState title="No structural chart data" description="No OHLCV history exists for the active symbol and timeframe." icon={Inventory2Rounded} minHeight={430} />
        )}
        {props.zones.length ? (
          <ZoneRail zones={props.zones} currentValue={props.currentValue} symbol={props.selectedSymbol} alertThreshold={props.alertThreshold} />
        ) : (
          <EmptyState title="No nearby zones" description="No supply or demand zone passed the active quality filter." icon={Inventory2Rounded} minHeight={430} />
        )}
      </Box>
      <ZoneInventory zones={props.zones} currentValue={props.currentValue} />
    </Stack>
  );
}

export function ZoneAnalyzerView(props: MarketWorkspaceViewProps) {
  const headingId = "zone-analyzer-view-title";
  const nearestZone = useMemo(
    () => [...props.zones].sort((left, right) => distanceFromZone(props.currentValue, left) - distanceFromZone(props.currentValue, right))[0],
    [props.currentValue, props.zones],
  );
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const selectedZone = props.zones.find((zone) => zone.id === selectedZoneId) ?? nearestZone;
  const selectedDistance = selectedZone ? distanceFromZone(props.currentValue, selectedZone) : undefined;
  const averageQuality = props.zones.length
    ? props.zones.reduce((total, zone) => total + zone.strength, 0) / props.zones.length
    : 0;
  return (
    <Stack component="section" aria-labelledby={headingId} spacing={2}>
      <ViewIntro
        id={headingId}
        eyebrow="Structure diagnostics"
        title="Zone analyzer"
        description="Interrogate each detected structure, its exact bounds, freshness, validation signals, quality, and distance from price."
        icon={AssessmentRounded}
        action={<Button startIcon={<AddAlertRounded />} onClick={props.onCreateAlert} sx={{ color: marketColors.ink, bgcolor: marketColors.cyan, fontSize: "0.59rem", fontWeight: 850, textTransform: "none", "&:hover": { bgcolor: "#69dfff" } }}>Alert this structure</Button>}
      />
      <MetricCards
        metrics={[
          { label: "Detected zones", value: props.zones.length.toLocaleString(), detail: `${props.selectedSymbol} · ${props.timeframe.toUpperCase()}`, tone: "neutral" },
          { label: "Average quality", value: props.zones.length ? `${averageQuality.toFixed(0)}/100` : "—", detail: "Across the visible inventory", tone: averageQuality >= 70 ? "positive" : "warning", progress: averageQuality },
          { label: "Nearest structure", value: selectedDistance === undefined ? "—" : selectedDistance === 0 ? "Inside" : `${selectedDistance.toFixed(2)}%`, detail: selectedZone ? `${selectedZone.type} · ${selectedZone.tested ? "tested" : "virgin"}` : "No qualifying structure", tone: selectedZone?.type === "demand" ? "positive" : selectedZone ? "negative" : "neutral" },
          { label: "Current quote", value: formatMarketValue(props.currentValue), detail: signedPercent(props.changePercent), tone: props.changePercent >= 0 ? "positive" : "negative" },
        ]}
      />
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", xl: "minmax(0, 1.55fr) minmax(300px, 0.58fr)" }, gap: 2, alignItems: "stretch" }}>
        {props.candles.length ? (
          <CandlestickZoneChart key={`${props.selectedSymbol}:${props.timeframe}`} {...chartProps(props)} />
        ) : (
          <EmptyState title="No price structure to inspect" description="Select an asset and timeframe with synchronized OHLCV history." icon={AssessmentRounded} minHeight={430} />
        )}
        <ZoneDetails zone={selectedZone} currentValue={props.currentValue} />
      </Box>
      <ZoneInventory
        zones={props.zones}
        currentValue={props.currentValue}
        selectedZoneId={selectedZone?.id}
        onSelect={(zone) => setSelectedZoneId(zone.id)}
        title="Structural zone inventory"
      />
    </Stack>
  );
}

export function AlertCenterView(props: MarketWorkspaceViewProps) {
  const headingId = "alert-center-view-title";
  return (
    <Stack component="section" aria-labelledby={headingId} spacing={2}>
      <ViewIntro
        id={headingId}
        eyebrow="Event operations"
        title="Alert center"
        description="Monitor armed rules, zone-entry events, boundary crossings, and their synchronized market context."
        icon={NotificationsActiveRounded}
        action={<Button startIcon={<AddAlertRounded />} onClick={props.onCreateAlert} sx={{ color: marketColors.ink, bgcolor: marketColors.cyan, fontSize: "0.59rem", fontWeight: 850, textTransform: "none", "&:hover": { bgcolor: "#69dfff" } }}>New alert</Button>}
      />
      <AlertSummary alerts={props.alerts} />
      {props.alerts.length && props.watchlist.length ? (
        <MarketOperations
          alerts={props.alerts}
          assets={props.watchlist}
          onCreateAlert={props.onCreateAlert}
          onOpenAlert={props.onOpenAlert}
          onAssetSelect={props.onWatchlistAssetSelect}
        />
      ) : (
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.35fr) minmax(280px, 0.65fr)" }, gap: 2, alignItems: "stretch" }}>
          <AlertLedger alerts={props.alerts} onCreateAlert={props.onCreateAlert} onOpenAlert={props.onOpenAlert} />
          <WatchlistContext watchlist={props.watchlist} onSelect={props.onWatchlistAssetSelect} />
        </Box>
      )}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1.45fr) minmax(280px, 0.55fr)" }, gap: 2, alignItems: "stretch" }}>
        <ZoneInventory zones={props.zones} currentValue={props.currentValue} title="Alertable structures" />
        {props.zones.length ? (
          <ZoneRail zones={props.zones} currentValue={props.currentValue} symbol={props.selectedSymbol} alertThreshold={props.alertThreshold} />
        ) : (
          <EmptyState title="No alertable zone context" description="Create or import enough history to detect zone boundaries for threshold monitoring." icon={NotificationsActiveRounded} minHeight={340} />
        )}
      </Box>
    </Stack>
  );
}

export function MarketWorkspaceView({ view, ...props }: MarketWorkspaceDispatcherProps) {
  switch (view) {
    case "Global markets":
      return <GlobalMarketsView {...props} />;
    case "Index studio":
      return <IndexStudioView {...props} />;
    case "Supply & demand":
      return <SupplyDemandView {...props} />;
    case "Zone analyzer":
      return <ZoneAnalyzerView {...props} />;
    case "Alert center":
      return <AlertCenterView {...props} />;
  }
}

export const MarketWorkspaceViews = MarketWorkspaceView;

export default MarketWorkspaceView;

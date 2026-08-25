"use client";

import { useId, useMemo, useState } from "react";
import AutoGraphRounded from "@mui/icons-material/AutoGraphRounded";
import BoltRounded from "@mui/icons-material/BoltRounded";
import CloseRounded from "@mui/icons-material/CloseRounded";
import OpenInFullRounded from "@mui/icons-material/OpenInFullRounded";
import { Box, Button, Chip, Dialog, DialogContent, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { formatMarketValue, marketColors, MarketPanel, StatusDot } from "./MarketPanel";
import type { Candle, PriceZone } from "./types";
import { formatMarketSymbolForDisplay } from "@/lib/market/market-stream-adapter";

export interface CandlestickZoneChartProps {
  candles?: Candle[];
  zones?: PriceZone[];
  symbol?: string;
  name?: string;
  currentValue?: number;
  change?: number;
  changePercent?: number;
  timeframe?: string;
  initialTimeframe?: string;
  timeframes?: string[];
  onTimeframeChange?: (timeframe: string) => void;
  isLoading?: boolean;
  /** Disable the independent expanded view for a chart rendered in a dialog. */
  enableExpand?: boolean;
  onExpand?: () => void;
}

const CHART_WIDTH = 900;
const CHART_HEIGHT = 390;
const PLOT = { left: 24, right: 78, top: 20, bottom: 47 };

function zoneBounds(zone: PriceZone) {
  return {
    high: Math.max(zone.proximal, zone.distal),
    low: Math.min(zone.proximal, zone.distal),
  };
}

function resolvedCandleIndex(
  candles: Candle[],
  structuralIndex?: number,
  structuralTimestamp?: number,
) {
  if (typeof structuralTimestamp === "number" && Number.isFinite(structuralTimestamp)) {
    let nearestIndex: number | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    candles.forEach((candle, index) => {
      if (typeof candle.timestamp !== "number" || !Number.isFinite(candle.timestamp)) return;
      const distance = Math.abs(candle.timestamp - structuralTimestamp);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    });
    if (nearestIndex !== undefined) return nearestIndex;
  }

  if (
    typeof structuralIndex === "number" &&
    Number.isInteger(structuralIndex) &&
    structuralIndex >= 0 &&
    structuralIndex < candles.length
  ) {
    return structuralIndex;
  }

  return undefined;
}

function timeframeKey(value: string) {
  return value.toLowerCase();
}

function timeframeLabel(value: string) {
  return timeframeKey(value) === "1d" ? "1D" : value;
}

function CandlestickChartPanel({
  candles = [],
  zones = [],
  symbol = "GMI",
  name = "Global Market Index",
  currentValue = 0,
  change = 0,
  changePercent = 0,
  timeframe: controlledTimeframe,
  initialTimeframe = "15m",
  timeframes = ["15m", "30m", "1h", "4h", "1d"],
  onTimeframeChange,
  isLoading = false,
  enableExpand = true,
  onExpand,
}: CandlestickZoneChartProps) {
  const [localTimeframe, setLocalTimeframe] = useState(initialTimeframe);
  const activeTimeframe = controlledTimeframe ?? localTimeframe;
  const displaySymbol = formatMarketSymbolForDisplay(symbol);
  const svgId = useId().replace(/:/g, "");
  const fadeId = `${svgId}-fade`;
  const gridId = `${svgId}-grid`;
  const shadowId = `${svgId}-shadow`;
  const source = useMemo(
    () => candles.filter((candle) => !candle.symbol || candle.symbol.toUpperCase() === symbol.toUpperCase()),
    [candles, symbol],
  );
  const visibleZones = useMemo(
    () => zones.filter((zone) => !zone.symbol || zone.symbol.toUpperCase() === symbol.toUpperCase()),
    [symbol, zones],
  );

  const chart = useMemo(() => {
    if (!source.length) return null;
    const candleHighs = source.map((candle) => candle.high);
    const candleLows = source.map((candle) => candle.low);
    const zoneHighs = visibleZones.map((zone) => zoneBounds(zone).high);
    const zoneLows = visibleZones.map((zone) => zoneBounds(zone).low);
    const rawMin = Math.min(...candleLows, ...zoneLows, currentValue);
    const rawMax = Math.max(...candleHighs, ...zoneHighs, currentValue);
    const pad = Math.max((rawMax - rawMin) * 0.07, 1);
    const min = rawMin - pad;
    const max = rawMax + pad;
    const plotWidth = CHART_WIDTH - PLOT.left - PLOT.right;
    const plotHeight = CHART_HEIGHT - PLOT.top - PLOT.bottom;
    const step = plotWidth / source.length;
    const candleWidth = Math.max(4, Math.min(11, step * 0.58));
    const y = (price: number) => PLOT.top + ((max - price) / (max - min)) * plotHeight;
    const x = (index: number) => PLOT.left + step * index + step / 2;
    const ticks = Array.from({ length: 6 }, (_, index) => max - ((max - min) * index) / 5);
    return { min, max, plotWidth, plotHeight, step, candleWidth, y, x, ticks };
  }, [currentValue, source, visibleZones]);

  const composite = useMemo(
    () => source.length
      ? ({
          open: source[0].open,
          high: Math.max(...source.map((candle) => candle.high)),
          low: Math.min(...source.map((candle) => candle.low)),
          close: source[source.length - 1].close,
        })
      : null,
    [source],
  );

  const handleTimeframe = (next: string) => {
    if (controlledTimeframe === undefined) setLocalTimeframe(next);
    onTimeframeChange?.(next);
  };

  if (!chart || !composite) {
    return (
      <MarketPanel sx={{ height: "100%" }} contentSx={{ height: "100%" }}>
        <Box sx={{ px: { xs: 2, sm: 2.5 }, py: { xs: 2, sm: 2.4 } }}>
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "stretch", sm: "flex-start" }}
            justifyContent="space-between"
            spacing={1.5}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  display: "grid",
                  placeItems: "center",
                  color: marketColors.cyan,
                  bgcolor: marketColors.cyanSoft,
                  border: "1px solid rgba(36,185,243,0.22)",
                  borderRadius: "10px",
                }}
              >
                <AutoGraphRounded sx={{ fontSize: 19 }} />
              </Box>
              <Box>
                <Typography component="h2" sx={{ fontSize: "0.95rem", fontWeight: 850 }}>
                  {displaySymbol}
                </Typography>
                <Typography sx={{ mt: 0.25, color: marketColors.muted, fontSize: "0.62rem" }}>
                  {name}
                </Typography>
              </Box>
            </Stack>
            <Stack direction="row" spacing={0.5} sx={{ overflowX: "auto", pb: 0.25 }}>
              {timeframes.map((item) => {
                const active = timeframeKey(item) === timeframeKey(activeTimeframe);
                return (
                  <Button
                    key={item}
                    size="small"
                    onClick={() => handleTimeframe(item)}
                    aria-pressed={active}
                    sx={{
                      minWidth: 40,
                      height: 29,
                      px: 1,
                      color: active ? marketColors.text : marketColors.muted,
                      bgcolor: active ? marketColors.cyanSoft : "transparent",
                      border: `1px solid ${active ? "rgba(36,185,243,0.30)" : marketColors.line}`,
                      borderRadius: "8px",
                      fontSize: "0.62rem",
                      fontWeight: 750,
                    }}
                  >
                    {timeframeLabel(item)}
                  </Button>
                );
              })}
              {enableExpand && onExpand && (
                <Tooltip title={`Open ${displaySymbol} chart`}>
                  <IconButton
                    size="small"
                    onClick={onExpand}
                    aria-label={`Open ${displaySymbol} candlestick chart`}
                    sx={{ width: 29, height: 29, color: marketColors.cyan, border: `1px solid ${marketColors.line}`, borderRadius: "8px" }}
                  >
                    <OpenInFullRounded sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              )}
            </Stack>
          </Stack>
          <Box
            role="status"
            sx={{
              minHeight: { xs: 300, sm: 390 },
              mt: 2,
              display: "grid",
              placeItems: "center",
              px: 2,
              textAlign: "center",
              bgcolor: "rgba(3,12,21,0.34)",
              border: `1px dashed ${marketColors.line}`,
              borderRadius: "14px",
            }}
          >
            <Box>
              <Typography sx={{ fontSize: "0.82rem", fontWeight: 800 }}>
                {isLoading
                  ? `Loading ${timeframeLabel(activeTimeframe)} bars for ${displaySymbol}`
                  : `No ${timeframeLabel(activeTimeframe)} bars for ${displaySymbol}`}
              </Typography>
              <Typography sx={{ mt: 0.6, color: marketColors.muted, fontSize: "0.62rem" }}>
                {isLoading
                  ? "Synchronizing the selected provider dataset…"
                  : "Select an imported timeframe or upload OHLCV data for this interval."}
              </Typography>
            </Box>
          </Box>
        </Box>
      </MarketPanel>
    );
  }

  return (
    <MarketPanel
      sx={{ height: "100%" }}
      contentSx={{ height: "100%" }}
    >
      <Box sx={{ px: { xs: 2, sm: 2.5 }, pt: { xs: 2, sm: 2.4 } }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "stretch", sm: "flex-start" }}
          justifyContent="space-between"
          spacing={1.5}
        >
          <Box>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  display: "grid",
                  placeItems: "center",
                  color: marketColors.cyan,
                  bgcolor: marketColors.cyanSoft,
                  border: "1px solid rgba(36,185,243,0.22)",
                  borderRadius: "10px",
                }}
              >
                <AutoGraphRounded sx={{ fontSize: 19 }} />
              </Box>
              <Box>
                <Stack direction="row" alignItems="baseline" spacing={0.8}>
                  <Typography component="h2" sx={{ fontSize: "0.95rem", fontWeight: 850 }}>
                    {displaySymbol}
                  </Typography>
                  <Typography sx={{ color: marketColors.muted, fontSize: "0.64rem" }}>{name}</Typography>
                </Stack>
                <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mt: 0.4 }}>
                  <Typography sx={{ fontSize: { xs: "1.45rem", sm: "1.72rem" }, fontWeight: 750, letterSpacing: "-0.045em" }}>
                    {formatMarketValue(currentValue)}
                  </Typography>
                  <Typography sx={{ color: change >= 0 ? marketColors.demand : marketColors.supply, fontSize: "0.69rem", fontWeight: 800 }}>
                    {change >= 0 ? "+" : ""}{change.toFixed(2)} ({changePercent >= 0 ? "+" : ""}{changePercent.toFixed(2)}%)
                  </Typography>
                </Stack>
              </Box>
            </Stack>
          </Box>

          <Stack direction="row" spacing={0.5} sx={{ overflowX: "auto", pb: 0.25 }}>
            {timeframes.map((item) => {
              const active = timeframeKey(item) === timeframeKey(activeTimeframe);
              return (
                <Button
                  key={item}
                  size="small"
                  onClick={() => handleTimeframe(item)}
                  aria-pressed={active}
                  sx={{
                    minWidth: 40,
                    height: 29,
                    px: 1,
                    color: active ? marketColors.text : marketColors.muted,
                    bgcolor: active ? marketColors.cyanSoft : "transparent",
                    border: `1px solid ${active ? "rgba(36,185,243,0.30)" : marketColors.line}`,
                    borderRadius: "8px",
                    fontSize: "0.62rem",
                    fontWeight: 750,
                    "&:hover": { bgcolor: active ? marketColors.cyanSoft : "rgba(255,255,255,0.04)" },
                  }}
                >
                  {timeframeLabel(item)}
                </Button>
              );
            })}
            {enableExpand && onExpand && (
              <Tooltip title={`Open ${displaySymbol} chart`}>
                <IconButton
                  size="small"
                  onClick={onExpand}
                  aria-label={`Open ${displaySymbol} candlestick chart`}
                  sx={{ width: 29, height: 29, color: marketColors.cyan, border: `1px solid ${marketColors.line}`, borderRadius: "8px" }}
                >
                  <OpenInFullRounded sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>

        <Stack
          direction="row"
          alignItems="center"
          spacing={{ xs: 1.4, sm: 2.5 }}
          sx={{ mt: 1.6, overflowX: "auto", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
        >
          <Stack direction="row" spacing={0.65} alignItems="center">
            <StatusDot color={marketColors.demand} />
            <Typography sx={{ color: marketColors.muted, fontSize: "0.59rem", whiteSpace: "nowrap" }}>Visible range</Typography>
          </Stack>
          {([
            ["O", composite.open],
            ["H", composite.high],
            ["L", composite.low],
            ["C", composite.close],
          ] as const).map(([label, value]) => (
            <Typography key={label} sx={{ color: marketColors.muted, fontSize: "0.59rem", whiteSpace: "nowrap" }}>
              {label} <Box component="span" sx={{ color: marketColors.text, fontWeight: 700 }}>{formatMarketValue(value)}</Box>
            </Typography>
          ))}
        </Stack>
      </Box>

      <Box sx={{ mt: 1.3, px: { xs: 0.75, sm: 1.5 }, pb: 1.25 }}>
        <Box
          component="svg"
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label={`${displaySymbol} candlestick chart with supply and demand zones on the ${timeframeLabel(activeTimeframe)} timeframe`}
          sx={{ display: "block", width: "100%", height: { xs: 330, sm: 390 } }}
        >
          <defs>
            <linearGradient id={fadeId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#10263A" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#071421" stopOpacity="0" />
            </linearGradient>
            <pattern id={gridId} width="72" height="64" patternUnits="userSpaceOnUse">
              <path d="M 72 0 L 0 0 0 64" fill="none" stroke="rgba(137,170,200,0.07)" strokeWidth="1" />
            </pattern>
            <filter id={shadowId} x="-30%" y="-30%" width="160%" height="160%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#020912" floodOpacity="0.5" />
            </filter>
          </defs>
          <rect x={PLOT.left} y={PLOT.top} width={chart.plotWidth} height={chart.plotHeight} rx="9" fill={`url(#${fadeId})`} />
          <rect x={PLOT.left} y={PLOT.top} width={chart.plotWidth} height={chart.plotHeight} rx="9" fill={`url(#${gridId})`} />

          {chart.ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PLOT.left}
                x2={CHART_WIDTH - PLOT.right}
                y1={chart.y(tick)}
                y2={chart.y(tick)}
                stroke="rgba(137,170,200,0.09)"
                strokeDasharray="3 6"
              />
              <text
                x={CHART_WIDTH - PLOT.right + 9}
                y={chart.y(tick) + 3}
                fill="#6F8499"
                fontSize="9"
                fontWeight="600"
              >
                {formatMarketValue(tick)}
              </text>
            </g>
          ))}

          {visibleZones.map((zone, index) => {
            const bounds = zoneBounds(zone);
            const isSupply = zone.type === "supply";
            const color = isSupply ? marketColors.supply : marketColors.cyan;
            const baseIndex = resolvedCandleIndex(
              source,
              zone.baseBarIndex,
              zone.baseTimestamp,
            );
            const impulseStartIndex = resolvedCandleIndex(
              source,
              zone.impulseStartIndex,
              zone.impulseStartTimestamp,
            );
            const impulseEndIndex = resolvedCandleIndex(
              source,
              zone.impulseEndIndex,
              zone.impulseEndTimestamp,
            );
            const zoneStartIndex = baseIndex ?? impulseStartIndex;
            const startX = zoneStartIndex === undefined
              ? PLOT.left + chart.plotWidth * (isSupply ? 0.32 : 0.02)
              : Math.max(PLOT.left, chart.x(zoneStartIndex) - chart.step / 2);
            const zoneY = chart.y(bounds.high);
            const zoneHeight = Math.max(chart.y(bounds.low) - zoneY, 4);

            const hasStructuralFvg = baseIndex !== undefined && impulseEndIndex !== undefined;
            const structuralFvgStart = impulseStartIndex ?? baseIndex;
            const fvgFirst = baseIndex === undefined ? undefined : source[baseIndex];
            const fvgLast = impulseEndIndex === undefined ? undefined : source[impulseEndIndex];
            const fvgPriceA = fvgFirst && fvgLast
              ? (isSupply ? fvgFirst.low : fvgFirst.high)
              : undefined;
            const fvgPriceB = fvgFirst && fvgLast
              ? (isSupply ? fvgLast.high : fvgLast.low)
              : undefined;
            const fvgHigh = fvgPriceA === undefined || fvgPriceB === undefined
              ? undefined
              : Math.max(fvgPriceA, fvgPriceB);
            const fvgLow = fvgPriceA === undefined || fvgPriceB === undefined
              ? undefined
              : Math.min(fvgPriceA, fvgPriceB);
            const structuralFvgX = structuralFvgStart === undefined || impulseEndIndex === undefined
              ? undefined
              : chart.x(Math.min(structuralFvgStart, impulseEndIndex)) - chart.step / 2;
            const structuralFvgWidth = structuralFvgStart === undefined || impulseEndIndex === undefined
              ? undefined
              : Math.max(
                  chart.step,
                  chart.x(Math.max(structuralFvgStart, impulseEndIndex)) -
                    chart.x(Math.min(structuralFvgStart, impulseEndIndex)) +
                    chart.step,
                );
            const showLegacyFvg = !hasStructuralFvg && index === 0;
            const fvgX = hasStructuralFvg && structuralFvgX !== undefined
              ? structuralFvgX
              : PLOT.left + chart.plotWidth * 0.57;
            const fvgWidth = hasStructuralFvg && structuralFvgWidth !== undefined
              ? structuralFvgWidth
              : chart.plotWidth * 0.14;
            const fvgY = hasStructuralFvg && fvgHigh !== undefined
              ? chart.y(fvgHigh)
              : chart.y(source[15]?.high ?? currentValue + 1.5);
            const fvgHeight = hasStructuralFvg && fvgLow !== undefined
              ? Math.max(chart.y(fvgLow) - fvgY, 6)
              : Math.max(
                  chart.y(source[14]?.low ?? currentValue) -
                    chart.y(source[15]?.high ?? currentValue + 1.5),
                  6,
                );
            return (
              <g key={zone.id}>
                <rect
                  x={startX}
                  y={zoneY}
                  width={CHART_WIDTH - PLOT.right - startX}
                  height={zoneHeight}
                  rx="3"
                  fill={`${color}18`}
                  stroke={`${color}70`}
                  strokeWidth="1"
                  strokeDasharray={zone.tested ? "4 5" : undefined}
                />
                <rect x={startX + 8} y={zoneY + 8} width={isSupply ? 79 : 84} height="20" rx="5" fill={`${color}DD`} filter={`url(#${shadowId})`} />
                <text x={startX + 17} y={zoneY + 21.5} fill={isSupply ? "#31090D" : "#021D2B"} fontSize="9" fontWeight="900" letterSpacing="0.08em">
                  {zone.type.toUpperCase()} · {zone.strength}
                </text>
                {zone.fairValueGap && (hasStructuralFvg || showLegacyFvg) && (
                  <g>
                    <rect
                      x={fvgX}
                      y={fvgY}
                      width={fvgWidth}
                      height={fvgHeight}
                      fill="rgba(248,186,87,0.09)"
                      stroke="rgba(248,186,87,0.45)"
                      strokeDasharray="3 4"
                    />
                    <text x={fvgX + 4} y={fvgY - 5} fill={marketColors.warning} fontSize="8" fontWeight="700">FVG</text>
                  </g>
                )}
              </g>
            );
          })}

          {source.map((candle, index) => {
            const rising = candle.close >= candle.open;
            const color = rising ? marketColors.demand : marketColors.supply;
            const bodyTop = chart.y(Math.max(candle.open, candle.close));
            const bodyHeight = Math.max(Math.abs(chart.y(candle.open) - chart.y(candle.close)), 2);
            const candleX = chart.x(index);
            return (
              <g key={`${candle.time}-${index}`}>
                <title>{`${candle.time} O ${candle.open} H ${candle.high} L ${candle.low} C ${candle.close}`}</title>
                <line x1={candleX} x2={candleX} y1={chart.y(candle.high)} y2={chart.y(candle.low)} stroke={color} strokeWidth="1.25" />
                <rect
                  x={candleX - chart.candleWidth / 2}
                  y={bodyTop}
                  width={chart.candleWidth}
                  height={bodyHeight}
                  rx="1"
                  fill={color}
                  stroke={color}
                />
              </g>
            );
          })}

          <line
            x1={PLOT.left}
            x2={CHART_WIDTH - PLOT.right + 5}
            y1={chart.y(currentValue)}
            y2={chart.y(currentValue)}
            stroke={marketColors.cyan}
            strokeWidth="1"
            strokeDasharray="3 4"
          />
          <g transform={`translate(${CHART_WIDTH - PLOT.right + 4} ${chart.y(currentValue) - 10})`} filter={`url(#${shadowId})`}>
            <rect width="68" height="20" rx="5" fill={marketColors.cyan} />
            <text x="34" y="13.5" textAnchor="middle" fill="#001723" fontSize="9" fontWeight="900">{formatMarketValue(currentValue)}</text>
          </g>

          {source.map((candle, index) => {
            if (index % 6 !== 0 && index !== source.length - 1) return null;
            return (
              <text key={`time-${index}`} x={chart.x(index)} y={CHART_HEIGHT - 17} textAnchor="middle" fill="#6F8499" fontSize="8.5">
                {candle.time}
              </text>
            );
          })}
        </Box>

        <Stack
          direction={{ xs: "column", sm: "row" }}
          alignItems={{ xs: "stretch", sm: "center" }}
          justifyContent="space-between"
          spacing={1}
          sx={{ px: { xs: 1.25, sm: 1.75 }, pt: 0.2 }}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Stack direction="row" spacing={0.7} alignItems="center">
              <Box sx={{ width: 11, height: 7, bgcolor: marketColors.supplySoft, border: `1px solid ${marketColors.supply}`, borderRadius: "2px" }} />
              <Typography sx={{ color: marketColors.muted, fontSize: "0.59rem" }}>Supply</Typography>
            </Stack>
            <Stack direction="row" spacing={0.7} alignItems="center">
              <Box sx={{ width: 11, height: 7, bgcolor: marketColors.cyanSoft, border: `1px solid ${marketColors.cyan}`, borderRadius: "2px" }} />
              <Typography sx={{ color: marketColors.muted, fontSize: "0.59rem" }}>Demand</Typography>
            </Stack>
            <Stack direction="row" spacing={0.7} alignItems="center">
              <Box sx={{ width: 11, borderTop: `1px dashed ${marketColors.warning}` }} />
              <Typography sx={{ color: marketColors.muted, fontSize: "0.59rem" }}>Fair value gap</Typography>
            </Stack>
          </Stack>
          <Chip
            icon={<BoltRounded sx={{ fontSize: "14px !important" }} />}
            label={`${visibleZones.length} active ${visibleZones.length === 1 ? "structure" : "structures"}`}
            size="small"
            sx={{
              alignSelf: { xs: "flex-start", sm: "auto" },
              height: 25,
              color: marketColors.warning,
              bgcolor: "rgba(248,186,87,0.10)",
              fontSize: "0.6rem",
              fontWeight: 700,
              "& .MuiChip-icon": { color: marketColors.warning },
            }}
          />
        </Stack>
      </Box>
    </MarketPanel>
  );
}

export default function CandlestickZoneChart(props: CandlestickZoneChartProps) {
  const [expanded, setExpanded] = useState(false);
  const [localTimeframe, setLocalTimeframe] = useState(
    props.initialTimeframe ?? props.timeframe ?? "15m",
  );
  const activeTimeframe = props.timeframe ?? localTimeframe;
  const handleTimeframeChange = (next: string) => {
    if (props.timeframe === undefined) setLocalTimeframe(next);
    props.onTimeframeChange?.(next);
  };
  const panelProps = {
    ...props,
    timeframe: activeTimeframe,
    initialTimeframe: activeTimeframe,
    onTimeframeChange: handleTimeframeChange,
  };
  const canExpand = props.enableExpand !== false;

  return (
    <>
      <CandlestickChartPanel
        {...panelProps}
        enableExpand={canExpand}
        onExpand={() => setExpanded(true)}
      />
      {canExpand && (
        <Dialog
          open={expanded}
          onClose={() => setExpanded(false)}
          fullWidth
          maxWidth="xl"
          PaperProps={{ sx: { bgcolor: marketColors.ink, backgroundImage: "none", border: `1px solid ${marketColors.line}` } }}
        >
          <DialogContent sx={{ p: { xs: 0.5, sm: 1.5 } }}>
            <Stack direction="row" justifyContent="flex-end" sx={{ px: 0.5, pt: 0.25 }}>
              <IconButton
                onClick={() => setExpanded(false)}
                aria-label={`Close ${formatMarketSymbolForDisplay(props.symbol ?? "market")} chart`}
                sx={{ color: marketColors.muted }}
              >
                <CloseRounded sx={{ fontSize: 19 }} />
              </IconButton>
            </Stack>
            <CandlestickChartPanel {...panelProps} enableExpand={false} />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

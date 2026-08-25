"use client";

import AddAlertRounded from "@mui/icons-material/AddAlertRounded";
import ArrowForwardRounded from "@mui/icons-material/ArrowForwardRounded";
import NotificationsActiveRounded from "@mui/icons-material/NotificationsActiveRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import { Box, Button, Chip, IconButton, Stack, Typography } from "@mui/material";
import { formatMarketValue, marketColors, MarketPanel, StatusDot } from "./MarketPanel";
import type { MarketAlert, WatchlistAsset } from "./types";
import { formatMarketSymbolForDisplay } from "@/lib/market/market-stream-adapter";

export interface AlertsPanelProps {
  alerts?: MarketAlert[];
  onCreateAlert?: () => void;
  onOpenAlert?: (alert: MarketAlert) => void;
}

function conditionLabel(alert: MarketAlert) {
  if (alert.armed) {
    if (alert.condition === "inside") return "Armed for zone entry";
    if (alert.condition === "crossed") return "Armed for boundary crossing";
    return `Armed within ${alert.thresholdPercent.toFixed(1)}%`;
  }
  if (alert.condition === "inside") return "Price entered zone";
  if (alert.condition === "crossed") return "Zone boundary crossed";
  return `Within ${alert.thresholdPercent.toFixed(1)}% threshold`;
}

export function AlertsPanel({
  alerts = [],
  onCreateAlert,
  onOpenAlert,
}: AlertsPanelProps) {
  return (
    <MarketPanel
      title="Zone alerts"
      eyebrow="Live triggers"
      action={
        <IconButton
          size="small"
          onClick={onCreateAlert}
          aria-label="Configure zone alerts"
          sx={{ color: marketColors.muted, border: `1px solid ${marketColors.line}`, borderRadius: "9px" }}
        >
          <TuneRounded sx={{ fontSize: 16 }} />
        </IconButton>
      }
      contentSx={{ px: 1.5, pb: 1.5 }}
    >
      <Stack spacing={0.75}>
        {alerts.map((alert) => {
          const isSupply = alert.zoneType === "supply";
          const accent = isSupply ? marketColors.supply : marketColors.cyan;
          return (
            <Box
              key={alert.id}
              component="button"
              type="button"
              onClick={() => onOpenAlert?.(alert)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.1,
                width: "100%",
                px: 1.2,
                py: 1.15,
                color: marketColors.text,
                textAlign: "left",
                font: "inherit",
                bgcolor: "rgba(255,255,255,0.025)",
                border: `1px solid ${marketColors.line}`,
                borderRadius: "11px",
                cursor: onOpenAlert ? "pointer" : "default",
                transition: "background-color 150ms ease, border-color 150ms ease",
                "&:hover": { bgcolor: "rgba(255,255,255,0.045)", borderColor: `${accent}55` },
              }}
            >
              <Box sx={{ width: 31, height: 31, display: "grid", placeItems: "center", flex: "0 0 auto", color: accent, bgcolor: `${accent}16`, borderRadius: "9px" }}>
                <NotificationsActiveRounded sx={{ fontSize: 16 }} />
              </Box>
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={0.75}>
                  <Typography sx={{ fontSize: "0.68rem", fontWeight: 850 }}>{formatMarketSymbolForDisplay(alert.symbol)}</Typography>
                  <Chip
                    label={alert.zoneType}
                    size="small"
                    sx={{ height: 18, color: accent, bgcolor: `${accent}16`, fontSize: "0.49rem", fontWeight: 800, textTransform: "uppercase", "& .MuiChip-label": { px: 0.65 } }}
                  />
                </Stack>
                <Typography noWrap sx={{ mt: 0.35, color: marketColors.muted, fontSize: "0.56rem" }}>{conditionLabel(alert)}</Typography>
              </Box>
              <Box sx={{ textAlign: "right" }}>
                <Typography sx={{ color: accent, fontSize: "0.59rem", fontWeight: 800 }}>
                  {alert.armed
                    ? "armed"
                    : alert.currentDistancePercent === 0
                      ? "inside"
                      : `${Math.abs(alert.currentDistancePercent).toFixed(1)}%`}
                </Typography>
                <Typography sx={{ mt: 0.25, color: marketColors.muted, fontSize: "0.51rem" }}>{alert.triggeredAt}</Typography>
              </Box>
            </Box>
          );
        })}
      </Stack>

      <Button
        fullWidth
        startIcon={<AddAlertRounded sx={{ fontSize: "15px !important" }} />}
        onClick={onCreateAlert}
        sx={{ mt: 1, height: 34, color: marketColors.cyan, bgcolor: marketColors.cyanSoft, borderRadius: "9px", fontSize: "0.61rem", fontWeight: 750, "&:hover": { bgcolor: "rgba(36,185,243,0.20)" } }}
      >
        Create threshold alert
      </Button>
    </MarketPanel>
  );
}

function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  const width = 112;
  const height = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values
    .map((value, index) => `${(index / Math.max(values.length - 1, 1)) * width},${height - ((value - min) / range) * (height - 5) - 2.5}`)
    .join(" ");
  const accent = positive ? marketColors.demand : marketColors.supply;
  return (
    <Box component="svg" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" sx={{ display: "block", width: "100%", height: 34 }}>
      <polyline points={points} fill="none" stroke={accent} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={Number(points.split(" ").at(-1)?.split(",")[1] ?? 0)} r="2.5" fill={accent} />
    </Box>
  );
}

export interface WatchlistStripProps {
  assets?: WatchlistAsset[];
  onViewAll?: () => void;
  onAssetSelect?: (asset: WatchlistAsset) => void;
}

export function WatchlistStrip({
  assets = [],
  onViewAll,
  onAssetSelect,
}: WatchlistStripProps) {
  return (
    <MarketPanel
      title="Market watchlist"
      eyebrow="Tracked assets"
      action={
        <Button
          size="small"
          endIcon={<ArrowForwardRounded sx={{ fontSize: "14px !important" }} />}
          onClick={onViewAll}
          sx={{ color: marketColors.cyan, fontSize: "0.6rem", fontWeight: 750 }}
        >
          View all
        </Button>
      }
      contentSx={{ pb: 1.8 }}
    >
      <Box
        sx={{
          display: "flex",
          gap: 1,
          px: { xs: 1.5, sm: 2 },
          overflowX: "auto",
          scrollSnapType: "x proximity",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {assets.map((asset) => {
          const positive = asset.changePercent >= 0;
          const accent = positive ? marketColors.demand : marketColors.supply;
          const zoneAccent = asset.zoneState === "near supply" ? marketColors.supply : asset.zoneState === "near demand" ? marketColors.cyan : marketColors.muted;
          return (
            <Box
              key={asset.symbol}
              component="button"
              type="button"
              onClick={() => onAssetSelect?.(asset)}
              sx={{
                minWidth: 174,
                flex: "1 0 174px",
                p: 1.35,
                color: marketColors.text,
                textAlign: "left",
                font: "inherit",
                bgcolor: marketColors.panelSoft,
                border: `1px solid ${marketColors.line}`,
                borderRadius: "12px",
                cursor: onAssetSelect ? "pointer" : "default",
                scrollSnapAlign: "start",
                transition: "transform 160ms ease, border-color 160ms ease",
                "&:hover": { transform: "translateY(-2px)", borderColor: `${accent}55` },
              }}
            >
              <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography sx={{ fontSize: "0.7rem", fontWeight: 850 }}>{formatMarketSymbolForDisplay(asset.symbol)}</Typography>
                  <Typography noWrap sx={{ mt: 0.2, maxWidth: 90, color: marketColors.muted, fontSize: "0.52rem" }}>{asset.name}</Typography>
                </Box>
                <Stack direction="row" alignItems="center" spacing={0.55}>
                  <StatusDot color={zoneAccent} />
                  <Typography sx={{ color: zoneAccent, fontSize: "0.49rem", fontWeight: 750, textTransform: "capitalize" }}>{asset.zoneState}</Typography>
                </Stack>
              </Stack>
              <Stack direction="row" alignItems="flex-end" spacing={1} sx={{ mt: 1.2 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontSize: "0.91rem", fontWeight: 800 }}>{formatMarketValue(asset.value)}</Typography>
                  <Typography sx={{ mt: 0.25, color: accent, fontSize: "0.58rem", fontWeight: 800 }}>
                    {positive ? "+" : ""}{asset.changePercent.toFixed(2)}%
                  </Typography>
                </Box>
                <Box sx={{ width: 74 }}><Sparkline values={asset.sparkline} positive={positive} /></Box>
              </Stack>
            </Box>
          );
        })}
      </Box>
    </MarketPanel>
  );
}

export interface MarketOperationsProps extends AlertsPanelProps, WatchlistStripProps {}

export default function MarketOperations(props: MarketOperationsProps) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(270px, 0.72fr) minmax(0, 1.7fr)" }, gap: 2 }}>
      <AlertsPanel alerts={props.alerts} onCreateAlert={props.onCreateAlert} onOpenAlert={props.onOpenAlert} />
      <WatchlistStrip assets={props.assets} onViewAll={props.onViewAll} onAssetSelect={props.onAssetSelect} />
    </Box>
  );
}

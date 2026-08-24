"use client";

import { useState } from "react";
import CloseRounded from "@mui/icons-material/CloseRounded";
import DataUsageRounded from "@mui/icons-material/DataUsageRounded";
import HubRounded from "@mui/icons-material/HubRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import VerifiedRounded from "@mui/icons-material/VerifiedRounded";
import { Box, Button, Chip, Drawer, FormControl, IconButton, MenuItem, Select, Slider, Stack, Typography } from "@mui/material";
import { demoIndexAssets } from "./demoData";
import { marketColors, StatusDot } from "./MarketPanel";
import type { IndexAssetOption } from "./types";

export interface MarketControlBarProps {
  assets?: IndexAssetOption[];
  selectedSymbol: string;
  alertThreshold: number;
  onAssetChange: (symbol: string) => void;
  onAlertThresholdChange: (threshold: number) => void;
  dataQuality?: number;
  latencyMs?: number;
  lastUpdated?: string;
}

interface AssetSelectorProps {
  assets: IndexAssetOption[];
  selectedSymbol: string;
  onAssetChange: (symbol: string) => void;
  fullWidth?: boolean;
}

function AssetSelector({ assets, selectedSymbol, onAssetChange, fullWidth = false }: AssetSelectorProps) {
  if (assets.length > 6) {
    return (
      <FormControl size="small" sx={{ width: fullWidth ? "100%" : "min(34vw, 260px)" }}>
        <Select
          value={selectedSymbol}
          onChange={(event) => onAssetChange(event.target.value)}
          aria-label="Select market asset"
          sx={{
            height: 35,
            color: marketColors.text,
            bgcolor: "rgba(3,12,21,0.42)",
            fontSize: "0.62rem",
            fontWeight: 800,
            "& .MuiOutlinedInput-notchedOutline": { borderColor: marketColors.line },
          }}
        >
          {assets.map((asset) => (
            <MenuItem key={asset.symbol} value={asset.symbol} sx={{ fontSize: "0.7rem" }}>
              {asset.symbol} — {asset.name}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }
  return (
    <Box
      role="group"
      aria-label="Select market composite"
      sx={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(58px, 1fr))",
        gap: 0.55,
        width: fullWidth ? "100%" : "min(34vw, 430px)",
        p: 0.45,
        bgcolor: "rgba(3,12,21,0.42)",
        border: `1px solid ${marketColors.line}`,
        borderRadius: "11px",
      }}
    >
      {assets.map((asset) => {
        const active = asset.symbol === selectedSymbol;
        return (
          <Button
            key={asset.symbol}
            size="small"
            onClick={() => onAssetChange(asset.symbol)}
            aria-pressed={active}
            sx={{
              minWidth: fullWidth ? 0 : 58,
              px: fullWidth ? 1 : 1.35,
              py: 0.7,
              color: active ? marketColors.text : marketColors.muted,
              bgcolor: active ? marketColors.cyanSoft : "transparent",
              border: `1px solid ${active ? "rgba(36,185,243,0.34)" : "transparent"}`,
              borderRadius: "8px",
              fontSize: "0.62rem",
              fontWeight: 850,
              "&:hover": { bgcolor: active ? marketColors.cyanSoft : "rgba(255,255,255,0.04)" },
            }}
          >
            {asset.symbol}
          </Button>
        );
      })}
    </Box>
  );
}

function ThresholdControl({
  value,
  onChange,
  compact = false,
}: {
  value: number;
  onChange: (threshold: number) => void;
  compact?: boolean;
}) {
  return (
    <Box sx={{ width: compact ? 188 : "100%" }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.1 }}>
        <Typography sx={{ color: marketColors.muted, fontSize: "0.54rem", fontWeight: 700 }}>Zone approach</Typography>
        <Typography sx={{ color: marketColors.warning, fontSize: "0.61rem", fontWeight: 850 }}>±{value.toFixed(1)}%</Typography>
      </Stack>
      <Slider
        value={value}
        min={0.1}
        max={3}
        step={0.1}
        onChange={(_, next) => onChange(next as number)}
        aria-label="Zone alert approach percentage"
        valueLabelDisplay="auto"
        valueLabelFormat={(next) => `${next.toFixed(1)}%`}
        sx={{
          py: 0.4,
          color: marketColors.warning,
          "& .MuiSlider-thumb": { width: 11, height: 11, boxShadow: `0 0 0 4px ${marketColors.warning}20` },
          "& .MuiSlider-track": { border: 0 },
          "& .MuiSlider-rail": { bgcolor: "rgba(255,255,255,0.16)" },
          "& .MuiSlider-valueLabel": { bgcolor: marketColors.ink, fontSize: "0.56rem" },
        }}
      />
    </Box>
  );
}

export default function MarketControlBar({
  assets = demoIndexAssets,
  selectedSymbol,
  alertThreshold,
  onAssetChange,
  onAlertThresholdChange,
  dataQuality = 99.4,
  latencyMs = 84,
  lastUpdated = "Updated 4s ago",
}: MarketControlBarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const selected = assets.find((asset) => asset.symbol === selectedSymbol) ?? assets[0];
  const selectedDetail = selected?.dataSource === "alpha_vantage"
    ? `${selected.assetClass ?? "market"} · ${selected.priceBasis ?? "provider OHLC"}`
    : selected?.dataSource === "historical_import"
      ? `Imported OHLCV · ${selected.supportedTimeframes?.map((item) => item.toUpperCase()).join(", ") || "custom interval"}`
      : `${selected?.componentCount.toLocaleString() ?? "—"} components · synchronized OHLC`;

  return (
    <>
      <Box
        component="section"
        aria-label="Index construction and alert controls"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1.4,
          px: { xs: 1.3, sm: 1.5 },
          py: 1.15,
          color: marketColors.text,
          bgcolor: marketColors.panelSoft,
          border: `1px solid ${marketColors.line}`,
          borderRadius: "15px",
        }}
      >
        <Box sx={{ display: { xs: "none", md: "block" } }}>
          <Typography sx={{ mb: 0.55, color: marketColors.muted, fontSize: "0.54rem", fontWeight: 750, letterSpacing: "0.06em", textTransform: "uppercase" }}>
            Composite
          </Typography>
          <AssetSelector assets={assets} selectedSymbol={selectedSymbol} onAssetChange={onAssetChange} />
        </Box>

        <Stack direction="row" alignItems="center" spacing={1.2} sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ width: 34, height: 34, display: "grid", placeItems: "center", flex: "0 0 auto", color: marketColors.cyan, bgcolor: marketColors.cyanSoft, borderRadius: "10px" }}>
            <HubRounded sx={{ fontSize: 18 }} />
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography noWrap sx={{ fontSize: "0.69rem", fontWeight: 800 }}>{selected?.method ?? "Market-cap blend"}</Typography>
            <Typography noWrap sx={{ mt: 0.25, color: marketColors.muted, fontSize: "0.54rem" }}>
              {selectedDetail}
            </Typography>
          </Box>
        </Stack>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ display: { xs: "none", lg: "flex" } }}>
          <VerifiedRounded sx={{ color: marketColors.demand, fontSize: 17 }} />
          <Box>
            <Typography sx={{ color: marketColors.demand, fontSize: "0.64rem", fontWeight: 800 }}>{dataQuality.toFixed(1)}% data quality</Typography>
            <Typography sx={{ mt: 0.2, color: marketColors.muted, fontSize: "0.52rem" }}>{latencyMs}ms median · {lastUpdated}</Typography>
          </Box>
        </Stack>

        <Box sx={{ display: { xs: "none", md: "block" }, pl: 1.6, borderLeft: `1px solid ${marketColors.line}` }}>
          <ThresholdControl value={alertThreshold} onChange={onAlertThresholdChange} compact />
        </Box>

        <IconButton
          onClick={() => setMobileOpen(true)}
          aria-label="Open dashboard controls"
          sx={{ display: { xs: "inline-flex", md: "none" }, ml: "auto", color: marketColors.cyan, bgcolor: marketColors.cyanSoft, borderRadius: "10px" }}
        >
          <TuneRounded sx={{ fontSize: 19 }} />
        </IconButton>
      </Box>

      <Drawer
        anchor="right"
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: "min(88vw, 360px)",
              color: marketColors.text,
              bgcolor: marketColors.ink,
              backgroundImage: "linear-gradient(180deg, rgba(36,185,243,0.06), transparent 32%)",
              borderLeft: `1px solid ${marketColors.line}`,
            },
          },
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.8, borderBottom: `1px solid ${marketColors.line}` }}>
          <Box>
            <Typography sx={{ fontSize: "0.86rem", fontWeight: 800 }}>Dashboard controls</Typography>
            <Typography sx={{ mt: 0.25, color: marketColors.muted, fontSize: "0.56rem" }}>Composite, methodology and alerts</Typography>
          </Box>
          <IconButton onClick={() => setMobileOpen(false)} aria-label="Close dashboard controls" sx={{ color: marketColors.muted }}>
            <CloseRounded />
          </IconButton>
        </Stack>
        <Stack spacing={2.4} sx={{ p: 2 }}>
          <Box>
            <Typography sx={{ mb: 0.8, color: marketColors.muted, fontSize: "0.58rem", fontWeight: 750, textTransform: "uppercase" }}>Market composite</Typography>
            <AssetSelector assets={assets} selectedSymbol={selectedSymbol} onAssetChange={onAssetChange} fullWidth />
          </Box>
          <Box sx={{ p: 1.5, bgcolor: marketColors.panelSoft, border: `1px solid ${marketColors.line}`, borderRadius: "12px" }}>
            <Stack direction="row" spacing={1} alignItems="center">
              <DataUsageRounded sx={{ color: marketColors.cyan, fontSize: 19 }} />
              <Box>
                <Typography sx={{ fontSize: "0.69rem", fontWeight: 800 }}>{selected?.method}</Typography>
                <Typography sx={{ mt: 0.25, color: marketColors.muted, fontSize: "0.55rem" }}>{selectedDetail}</Typography>
              </Box>
            </Stack>
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mt: 1.3, pt: 1.3, borderTop: `1px solid ${marketColors.line}` }}>
              <StatusDot color={marketColors.demand} />
              <Typography sx={{ color: marketColors.demand, fontSize: "0.6rem", fontWeight: 750 }}>{dataQuality.toFixed(1)}% complete</Typography>
              <Chip label={`${latencyMs}ms`} size="small" sx={{ ml: "auto !important", height: 20, color: marketColors.muted, bgcolor: "rgba(255,255,255,0.06)", fontSize: "0.52rem" }} />
            </Stack>
          </Box>
          <Box>
            <Typography sx={{ mb: 1, color: marketColors.muted, fontSize: "0.58rem", fontWeight: 750, textTransform: "uppercase" }}>Alert sensitivity</Typography>
            <ThresholdControl value={alertThreshold} onChange={onAlertThresholdChange} />
          </Box>
        </Stack>
      </Drawer>
    </>
  );
}

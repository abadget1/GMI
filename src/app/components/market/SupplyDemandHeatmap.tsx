"use client";

import { useMemo, useState } from "react";
import FilterAltRounded from "@mui/icons-material/FilterAltRounded";
import { Box, Button, Chip, Stack, Tooltip, Typography } from "@mui/material";
import { demoHeatmap } from "./demoData";
import { marketColors, MarketPanel } from "./MarketPanel";
import type { HeatmapGroup, HeatmapMetric } from "./types";

export interface SupplyDemandHeatmapProps {
  metrics?: HeatmapMetric[];
  title?: string;
  initialGroup?: HeatmapGroup | "All";
  onMetricSelect?: (metric: HeatmapMetric) => void;
}

const groups: Array<HeatmapGroup | "All"> = [
  "All",
  "Energy",
  "Agriculture",
  "Industrial metals",
  "Semiconductors",
];

function signalColor(pressure: number) {
  if (pressure >= 0) {
    const alpha = 0.12 + Math.min(pressure, 100) * 0.0045;
    return {
      background: `linear-gradient(145deg, rgba(32,211,155,${alpha}), rgba(17,101,85,${Math.max(alpha - 0.12, 0.08)}))`,
      border: `rgba(32,211,155,${Math.min(alpha + 0.13, 0.78)})`,
      accent: marketColors.demand,
    };
  }
  const alpha = 0.12 + Math.min(Math.abs(pressure), 100) * 0.0045;
  return {
    background: `linear-gradient(145deg, rgba(255,109,117,${alpha}), rgba(126,39,54,${Math.max(alpha - 0.12, 0.08)}))`,
    border: `rgba(255,109,117,${Math.min(alpha + 0.13, 0.78)})`,
    accent: marketColors.supply,
  };
}

export default function SupplyDemandHeatmap({
  metrics = demoHeatmap,
  title = "Supply & demand pressure",
  initialGroup = "All",
  onMetricSelect,
}: SupplyDemandHeatmapProps) {
  const [activeGroup, setActiveGroup] = useState<HeatmapGroup | "All">(initialGroup);
  const visibleMetrics = useMemo(
    () => activeGroup === "All" ? metrics : metrics.filter((metric) => metric.group === activeGroup),
    [activeGroup, metrics],
  );
  const netPressure = metrics.length
    ? Math.round(metrics.reduce((total, metric) => total + metric.pressure, 0) / metrics.length)
    : 0;

  return (
    <MarketPanel
      title={title}
      eyebrow="Physical + market flows"
      action={
        <Chip
          label={`${netPressure >= 0 ? "+" : ""}${netPressure} net demand`}
          size="small"
          sx={{
            height: 27,
            color: netPressure >= 0 ? marketColors.demand : marketColors.supply,
            bgcolor: netPressure >= 0 ? marketColors.demandSoft : marketColors.supplySoft,
            fontSize: "0.61rem",
            fontWeight: 800,
          }}
        />
      }
      contentSx={{ px: { xs: 1.5, sm: 2 }, pb: 2 }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.7}
        sx={{ mb: 1.4, overflowX: "auto", scrollbarWidth: "none", "&::-webkit-scrollbar": { display: "none" } }}
      >
        <FilterAltRounded sx={{ mr: 0.3, color: marketColors.muted, fontSize: 16 }} />
        {groups.map((group) => {
          const active = group === activeGroup;
          return (
            <Button
              key={group}
              size="small"
              onClick={() => setActiveGroup(group)}
              aria-pressed={active}
              sx={{
                flex: "0 0 auto",
                minWidth: 0,
                height: 27,
                px: 1.15,
                color: active ? marketColors.text : marketColors.muted,
                bgcolor: active ? "rgba(255,255,255,0.075)" : "transparent",
                border: `1px solid ${active ? "rgba(255,255,255,0.12)" : marketColors.line}`,
                borderRadius: "8px",
                fontSize: "0.57rem",
                fontWeight: 700,
                whiteSpace: "nowrap",
                "&:hover": { bgcolor: "rgba(255,255,255,0.075)" },
              }}
            >
              {group}
            </Button>
          );
        })}
      </Stack>

      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "repeat(2, minmax(0, 1fr))",
            sm: activeGroup === "All" ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))",
          },
          gap: 0.85,
        }}
      >
        {visibleMetrics.map((metric) => {
          const signal = signalColor(metric.pressure);
          return (
            <Tooltip
              key={metric.id}
              title={`${metric.name}: ${metric.pressure > 0 ? "demand" : "supply"} pressure ${Math.abs(metric.pressure)}/100`}
              arrow
            >
              <Box
                component="button"
                type="button"
                onClick={() => onMetricSelect?.(metric)}
                sx={{
                  position: "relative",
                  minHeight: activeGroup === "All" ? 86 : 112,
                  p: 1.3,
                  color: marketColors.text,
                  textAlign: "left",
                  font: "inherit",
                  background: signal.background,
                  border: `1px solid ${signal.border}`,
                  borderRadius: "11px",
                  cursor: onMetricSelect ? "pointer" : "default",
                  overflow: "hidden",
                  transition: "transform 160ms ease, border-color 160ms ease",
                  "&:hover": { transform: "translateY(-2px)", borderColor: signal.accent },
                  "&:focus-visible": { outline: `2px solid ${marketColors.cyan}`, outlineOffset: 2 },
                  "&::after": {
                    content: '""',
                    position: "absolute",
                    right: -18,
                    bottom: -22,
                    width: 67,
                    height: 67,
                    borderRadius: "50%",
                    background: `${signal.accent}10`,
                  },
                }}
              >
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ color: "rgba(244,248,252,0.68)", fontSize: "0.52rem", fontWeight: 750, letterSpacing: "0.09em" }}>
                      {metric.ticker}
                    </Typography>
                    <Typography noWrap sx={{ mt: 0.35, fontSize: "0.69rem", fontWeight: 800 }}>
                      {metric.name}
                    </Typography>
                  </Box>
                  <Typography sx={{ color: signal.accent, fontSize: "0.68rem", fontWeight: 900 }}>
                    {metric.pressure > 0 ? "+" : ""}{metric.pressure}
                  </Typography>
                </Stack>
                <Stack direction="row" alignItems="flex-end" justifyContent="space-between" spacing={1} sx={{ mt: 1.3 }}>
                  <Typography sx={{ color: "rgba(244,248,252,0.66)", fontSize: "0.53rem", lineHeight: 1.25 }}>
                    {metric.flowLabel}
                  </Typography>
                  <Typography sx={{ color: metric.changePercent >= 0 ? marketColors.demand : marketColors.supply, fontSize: "0.59rem", fontWeight: 800 }}>
                    {metric.changePercent >= 0 ? "+" : ""}{metric.changePercent.toFixed(2)}%
                  </Typography>
                </Stack>
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1.4 }}>
        <Typography sx={{ color: marketColors.muted, fontSize: "0.55rem" }}>Supply</Typography>
        <Box sx={{ flex: 1, height: 5, borderRadius: 5, background: `linear-gradient(90deg, ${marketColors.supply}, rgba(255,255,255,0.14) 50%, ${marketColors.demand})` }} />
        <Typography sx={{ color: marketColors.muted, fontSize: "0.55rem" }}>Demand</Typography>
      </Stack>
    </MarketPanel>
  );
}


"use client";

import ArrowDownwardRounded from "@mui/icons-material/ArrowDownwardRounded";
import ArrowUpwardRounded from "@mui/icons-material/ArrowUpwardRounded";
import CheckCircleRounded from "@mui/icons-material/CheckCircleRounded";
import { Box, Chip, Stack, Typography } from "@mui/material";
import { formatMarketValue, marketColors, MarketPanel } from "./MarketPanel";
import type { PriceZone } from "./types";
import { formatMarketSymbolForDisplay } from "@/lib/market/market-stream-adapter";

export interface ZoneRailProps {
  zones?: PriceZone[];
  currentValue?: number;
  symbol?: string;
  alertThreshold?: number;
}

function distanceFromZone(current: number, zone: PriceZone) {
  const low = Math.min(zone.proximal, zone.distal);
  const high = Math.max(zone.proximal, zone.distal);
  if (current >= low && current <= high) return 0;
  const boundary = current < low ? low : high;
  return Math.abs(((boundary - current) / current) * 100);
}

function ZoneCard({ zone, currentValue }: { zone: PriceZone; currentValue: number }) {
  const isSupply = zone.type === "supply";
  const accent = isSupply ? marketColors.supply : marketColors.cyan;
  const soft = isSupply ? marketColors.supplySoft : marketColors.cyanSoft;
  const Icon = isSupply ? ArrowDownwardRounded : ArrowUpwardRounded;
  const distance = distanceFromZone(currentValue, zone);
  return (
    <Box
      sx={{
        p: 1.7,
        bgcolor: soft,
        border: `1px solid ${accent}40`,
        borderRadius: "14px",
        boxShadow: `inset 0 0 24px ${accent}0D`,
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <Box sx={{ width: 24, height: 24, display: "grid", placeItems: "center", color: accent, bgcolor: `${accent}18`, borderRadius: "7px" }}>
            <Icon sx={{ fontSize: 15 }} />
          </Box>
          <Typography sx={{ fontSize: "0.66rem", fontWeight: 850, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {zone.type} zone
          </Typography>
        </Stack>
        {!zone.tested && (
          <Chip
            label="Virgin"
            size="small"
            sx={{ height: 20, color: marketColors.demand, bgcolor: marketColors.demandSoft, fontSize: "0.53rem", fontWeight: 800, "& .MuiChip-label": { px: 0.75 } }}
          />
        )}
      </Stack>

      <Stack spacing={0.75} sx={{ mt: 1.5 }}>
        {([
          [isSupply ? "Distal" : "Proximal", isSupply ? Math.max(zone.proximal, zone.distal) : Math.max(zone.proximal, zone.distal)],
          [isSupply ? "Proximal" : "Distal", isSupply ? Math.min(zone.proximal, zone.distal) : Math.min(zone.proximal, zone.distal)],
        ] as [string, number][]).map(([label, value]) => (
          <Stack key={label} direction="row" justifyContent="space-between" alignItems="center" sx={{ px: 1.1, py: 0.85, bgcolor: "rgba(4,14,24,0.34)", borderRadius: "9px" }}>
            <Typography sx={{ color: marketColors.muted, fontSize: "0.55rem", fontWeight: 750, letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</Typography>
            <Typography sx={{ fontSize: "0.76rem", fontWeight: 800 }}>{formatMarketValue(value)}</Typography>
          </Stack>
        ))}
      </Stack>

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.25 }}>
        <Stack direction="row" spacing={0.5} alignItems="center">
          <CheckCircleRounded sx={{ color: marketColors.demand, fontSize: 14 }} />
          <Typography sx={{ color: marketColors.muted, fontSize: "0.56rem" }}>Quality {zone.strength}/100</Typography>
        </Stack>
        <Typography sx={{ color: accent, fontSize: "0.6rem", fontWeight: 800 }}>{distance.toFixed(1)}% away</Typography>
      </Stack>
    </Box>
  );
}

export default function ZoneRail({
  zones = [],
  currentValue = 0,
  symbol = "GMI",
  alertThreshold = 0.5,
}: ZoneRailProps) {
  const supply = zones.find((zone) => zone.type === "supply");
  const demand = zones.find((zone) => zone.type === "demand");

  return (
    <MarketPanel title="Zone proximity" eyebrow="Structure monitor" sx={{ height: "100%" }} contentSx={{ px: 1.5, pb: 1.6 }}>
      {supply && <ZoneCard zone={supply} currentValue={currentValue} />}

      <Box sx={{ position: "relative", py: 1.6, px: 1 }}>
        <Box sx={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 2, bgcolor: marketColors.line, transform: "translateX(-50%)" }} />
        <Box
          sx={{
            position: "relative",
            zIndex: 1,
            mx: "auto",
            width: "fit-content",
            minWidth: 112,
            px: 1.4,
            py: 0.9,
            textAlign: "center",
            bgcolor: marketColors.ink,
            border: `1px solid ${marketColors.demand}90`,
            borderRadius: "11px",
            boxShadow: `0 0 0 4px ${marketColors.demandSoft}, 0 8px 25px rgba(0,0,0,0.25)`,
          }}
        >
          <Typography sx={{ color: marketColors.muted, fontSize: "0.5rem", fontWeight: 750, letterSpacing: "0.09em" }}>{formatMarketSymbolForDisplay(symbol)} LIVE</Typography>
          <Typography sx={{ mt: 0.15, fontSize: "0.9rem", fontWeight: 850 }}>{formatMarketValue(currentValue)}</Typography>
        </Box>
      </Box>

      {demand && <ZoneCard zone={demand} currentValue={currentValue} />}

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1.35, px: 0.5 }}>
        <Typography sx={{ color: marketColors.muted, fontSize: "0.56rem" }}>Approach alert</Typography>
        <Chip
          label={`±${alertThreshold.toFixed(1)}%`}
          size="small"
          sx={{ height: 22, color: marketColors.warning, bgcolor: "rgba(248,186,87,0.10)", fontSize: "0.57rem", fontWeight: 750 }}
        />
      </Stack>
    </MarketPanel>
  );
}

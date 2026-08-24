"use client";

import TrendingDownRounded from "@mui/icons-material/TrendingDownRounded";
import TrendingUpRounded from "@mui/icons-material/TrendingUpRounded";
import { Box, Chip, Stack, Typography } from "@mui/material";
import { demoTickers } from "./demoData";
import { formatMarketValue, marketColors, StatusDot } from "./MarketPanel";
import type { MarketTicker } from "./types";

export interface TickerTapeProps {
  items?: MarketTicker[];
  marketStatus?: "live" | "open" | "closed";
  asOf?: string;
}

export default function TickerTape({
  items = demoTickers,
  marketStatus = "live",
  asOf = "Streaming · normalized",
}: TickerTapeProps) {
  const statusLabel =
    marketStatus === "live"
      ? "Market pulse"
      : `Markets ${marketStatus === "open" ? "open" : "closed"}`;
  const statusAccent =
    marketStatus === "closed"
      ? marketColors.supply
      : marketStatus === "open"
        ? marketColors.demand
        : marketColors.cyan;
  return (
    <Box
      component="section"
      aria-label="Live global market ticker"
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", lg: "auto minmax(0, 1fr)" },
        color: marketColors.text,
        bgcolor: marketColors.panel,
        border: `1px solid ${marketColors.line}`,
        borderRadius: "18px",
        overflow: "hidden",
        boxShadow: "0 16px 36px rgba(4, 13, 25, 0.14)",
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.25}
        sx={{
          px: 2,
          py: 1.35,
          minWidth: { lg: 184 },
          borderRight: { lg: `1px solid ${marketColors.line}` },
          borderBottom: { xs: `1px solid ${marketColors.line}`, lg: 0 },
        }}
      >
        <StatusDot color={statusAccent} />
        <Box>
          <Typography sx={{ fontSize: "0.72rem", fontWeight: 800, lineHeight: 1.2 }}>
            {statusLabel}
          </Typography>
          <Typography sx={{ mt: 0.25, color: marketColors.muted, fontSize: "0.61rem" }}>
            {asOf}
          </Typography>
        </Box>
        <Chip
          label={marketStatus === "closed" ? "PAUSED" : "LIVE"}
          size="small"
          sx={{
            ml: "auto !important",
            height: 21,
            color: statusAccent,
            bgcolor: `${statusAccent}18`,
            fontSize: "0.55rem",
            fontWeight: 900,
            letterSpacing: "0.08em",
            "& .MuiChip-label": { px: 0.9 },
          }}
        />
      </Stack>

      <Box
        sx={{
          display: "flex",
          minWidth: 0,
          overflowX: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {items.map((item) => {
          const positive = item.changePercent >= 0;
          const accent = positive ? marketColors.demand : marketColors.supply;
          const Icon = positive ? TrendingUpRounded : TrendingDownRounded;
          return (
            <Stack
              key={item.symbol}
              direction="row"
              alignItems="center"
              spacing={1.2}
              sx={{
                px: 2,
                py: 1.2,
                minWidth: 174,
                flex: "1 0 auto",
                borderRight: `1px solid ${marketColors.line}`,
                transition: "background-color 160ms ease",
                "&:hover": { bgcolor: "rgba(255,255,255,0.025)" },
              }}
            >
              <Box sx={{ minWidth: 0, flex: 1 }}>
                <Stack direction="row" spacing={0.75} alignItems="baseline">
                  <Typography sx={{ fontSize: "0.71rem", fontWeight: 800 }}>{item.symbol}</Typography>
                  <Typography
                    noWrap
                    sx={{ maxWidth: 74, color: marketColors.muted, fontSize: "0.57rem" }}
                  >
                    {item.name}
                  </Typography>
                </Stack>
                <Typography sx={{ mt: 0.35, fontSize: "0.84rem", fontWeight: 750, letterSpacing: "-0.02em" }}>
                  {item.prefix}
                  {formatMarketValue(item.value, item.precision ?? 2)}
                  {item.suffix}
                </Typography>
              </Box>
              <Stack alignItems="flex-end" spacing={0.1}>
                <Icon sx={{ color: accent, fontSize: 17 }} />
                <Typography sx={{ color: accent, fontSize: "0.64rem", fontWeight: 800 }}>
                  {positive ? "+" : ""}{item.changePercent.toFixed(2)}%
                </Typography>
              </Stack>
            </Stack>
          );
        })}
      </Box>
    </Box>
  );
}

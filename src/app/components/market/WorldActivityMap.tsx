"use client";

import { useId, useMemo, useState } from "react";
import LanguageRounded from "@mui/icons-material/LanguageRounded";
import { Box, Chip, Stack, Typography } from "@mui/material";
import { demoRegions } from "./demoData";
import { marketColors, MarketPanel, StatusDot } from "./MarketPanel";
import type { ActivityRegion, MarketSessionStatus } from "./types";

export interface WorldActivityMapProps {
  regions?: ActivityRegion[];
  title?: string;
}

const statusColor: Record<MarketSessionStatus, string> = {
  open: marketColors.demand,
  "pre-market": marketColors.warning,
  closed: marketColors.muted,
};

export default function WorldActivityMap({
  regions = demoRegions,
  title = "Global market activity",
}: WorldActivityMapProps) {
  const [selectedId, setSelectedId] = useState(regions[0]?.id ?? "");
  const svgId = useId().replace(/:/g, "");
  const gridId = `${svgId}-grid`;
  const glowId = `${svgId}-glow`;
  const selected = useMemo(
    () => regions.find((region) => region.id === selectedId) ?? regions[0],
    [regions, selectedId],
  );
  const openMarkets = regions.filter((region) => region.status === "open").length;

  return (
    <MarketPanel
      title={title}
      eyebrow="Cross-market pulse"
      action={
        <Chip
          icon={<LanguageRounded sx={{ fontSize: "15px !important" }} />}
          label={`${openMarkets} hubs live`}
          size="small"
          sx={{
            height: 28,
            color: marketColors.demand,
            bgcolor: marketColors.demandSoft,
            fontSize: "0.65rem",
            fontWeight: 750,
            "& .MuiChip-icon": { color: marketColors.demand },
          }}
        />
      }
      contentSx={{ px: { xs: 1.25, sm: 2 }, pb: 2 }}
    >
      <Box
        sx={{
          position: "relative",
          border: `1px solid ${marketColors.line}`,
          borderRadius: "15px",
          overflow: "hidden",
          background:
            "radial-gradient(circle at 54% 46%, rgba(36,185,243,0.10), transparent 35%), linear-gradient(180deg, #0A1A2B 0%, #071421 100%)",
        }}
      >
        <Box
          component="svg"
          viewBox="0 0 720 330"
          role="img"
          aria-label="World map with major market centers"
          sx={{ display: "block", width: "100%", height: { xs: 235, sm: 285 } }}
        >
          <defs>
            <pattern id={gridId} width="36" height="33" patternUnits="userSpaceOnUse">
              <path d="M 36 0 L 0 0 0 33" fill="none" stroke="rgba(135,163,188,0.08)" strokeWidth="1" />
            </pattern>
            <filter id={glowId} x="-200%" y="-200%" width="400%" height="400%">
              <feGaussianBlur stdDeviation="4" result="blur" />
              <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
            </filter>
          </defs>
          <rect width="720" height="330" fill={`url(#${gridId})`} />
          <g fill="#142A3C" stroke="#294155" strokeWidth="1.15">
            <path d="M74 79 105 47 153 42 178 58 210 64 226 92 207 109 184 105 172 126 148 133 133 156 112 151 103 122 80 113 64 94Z" />
            <path d="M178 155 204 163 223 191 239 204 234 235 220 257 209 292 194 283 188 252 175 231 168 201 157 180Z" />
            <path d="M326 72 352 58 383 64 401 80 430 84 448 105 475 102 491 117 526 120 548 136 541 156 508 159 489 179 459 171 442 148 416 145 393 128 374 133 357 117 335 113 316 94Z" />
            <path d="M367 135 397 135 423 155 438 185 425 210 413 247 389 264 371 241 360 213 344 191 349 159Z" />
            <path d="M474 164 495 161 505 179 491 196 474 189 464 174Z" />
            <path d="M541 122 570 104 607 99 646 113 659 133 638 147 607 146 588 158 557 151Z" />
            <path d="M574 220 607 207 643 220 655 242 637 262 605 268 580 252 565 235Z" />
            <path d="M326 59 337 40 354 43 359 58 344 67Z" />
            <path d="M653 161 665 169 659 185 648 176Z" />
          </g>

          <g fill="none" stroke="rgba(36,185,243,0.18)" strokeWidth="1" strokeDasharray="3 6">
            <path d="M176 135 Q270 80 345 106 T572 151" />
            <path d="M176 135 Q318 250 487 164 T625 135" />
            <path d="M242 238 Q340 143 487 164" />
          </g>

          {regions.map((region) => {
            const color = statusColor[region.status];
            const active = region.id === selectedId;
            return (
              <g
                key={region.id}
                role="button"
                tabIndex={0}
                aria-label={`${region.city}, ${region.status}, ${region.changePercent}%`}
                onClick={() => setSelectedId(region.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") setSelectedId(region.id);
                }}
                style={{ cursor: "pointer", outline: "none" }}
              >
                <circle cx={region.x} cy={region.y} r={active ? 16 : 11} fill={`${color}16`} stroke={`${color}55`} />
                <circle cx={region.x} cy={region.y} r={active ? 5 : 4} fill={color} filter={`url(#${glowId})`} />
                {active && (
                  <g transform={`translate(${Math.min(region.x + 12, 555)} ${Math.max(region.y - 54, 12)})`}>
                    <rect width="143" height="43" rx="8" fill="#10243A" stroke="rgba(255,255,255,0.12)" />
                    <text x="10" y="17" fill="#F4F8FC" fontSize="10" fontWeight="700">{region.city}</text>
                    <text x="10" y="32" fill="#8094AA" fontSize="8.5">{region.exchange} · {region.volumeLabel}</text>
                    <text x="132" y="17" textAnchor="end" fill={region.changePercent >= 0 ? marketColors.demand : marketColors.supply} fontSize="9" fontWeight="700">
                      {region.changePercent >= 0 ? "+" : ""}{region.changePercent.toFixed(2)}%
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </Box>

        <Stack
          direction="row"
          spacing={2}
          sx={{
            position: "absolute",
            left: 15,
            bottom: 12,
            px: 1.25,
            py: 0.8,
            bgcolor: "rgba(5,15,26,0.82)",
            border: `1px solid ${marketColors.line}`,
            borderRadius: "9px",
            backdropFilter: "blur(10px)",
          }}
        >
          {(["open", "pre-market", "closed"] as MarketSessionStatus[]).map((status) => (
            <Stack key={status} direction="row" alignItems="center" spacing={0.75}>
              <StatusDot color={statusColor[status]} />
              <Typography sx={{ color: marketColors.muted, fontSize: "0.58rem", textTransform: "capitalize" }}>
                {status}
              </Typography>
            </Stack>
          ))}
        </Stack>
      </Box>

      {selected && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            mt: 1.25,
            px: 0.25,
          }}
        >
          {[
            ["Selected hub", selected.city],
            ["Session volume", selected.volumeLabel],
            ["Day move", `${selected.changePercent >= 0 ? "+" : ""}${selected.changePercent.toFixed(2)}%`],
          ].map(([label, value], index) => (
            <Box key={label} sx={{ px: 1.5, borderLeft: index ? `1px solid ${marketColors.line}` : 0 }}>
              <Typography sx={{ color: marketColors.muted, fontSize: "0.58rem" }}>{label}</Typography>
              <Typography
                noWrap
                sx={{
                  mt: 0.4,
                  color: index === 2 ? (selected.changePercent >= 0 ? marketColors.demand : marketColors.supply) : marketColors.text,
                  fontSize: "0.73rem",
                  fontWeight: 750,
                }}
              >
                {value}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </MarketPanel>
  );
}

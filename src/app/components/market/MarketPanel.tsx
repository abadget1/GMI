"use client";

import type { ReactNode } from "react";
import { Box, Stack, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";

export const marketColors = {
  ink: "#06111F",
  panel: "#0A192A",
  panelSoft: "#0E2135",
  line: "rgba(137, 170, 200, 0.14)",
  text: "#F4F8FC",
  muted: "#8094AA",
  cyan: "#24B9F3",
  cyanSoft: "rgba(36, 185, 243, 0.14)",
  demand: "#20D39B",
  demandSoft: "rgba(32, 211, 155, 0.14)",
  supply: "#FF6D75",
  supplySoft: "rgba(255, 109, 117, 0.14)",
  warning: "#F8BA57",
} as const;

interface MarketPanelProps {
  children: ReactNode;
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  sx?: SxProps<Theme>;
  contentSx?: SxProps<Theme>;
}

export function MarketPanel({
  children,
  title,
  eyebrow,
  action,
  sx,
  contentSx,
}: MarketPanelProps) {
  return (
    <Box
      sx={{
        color: marketColors.text,
        bgcolor: marketColors.panel,
        border: `1px solid ${marketColors.line}`,
        borderRadius: "20px",
        boxShadow: "0 18px 45px rgba(4, 13, 25, 0.18)",
        overflow: "hidden",
        minWidth: 0,
        ...sx,
      }}
    >
      {(title || eyebrow || action) && (
        <Stack
          direction="row"
          alignItems="center"
          justifyContent="space-between"
          spacing={2}
          sx={{ px: { xs: 2, sm: 2.5 }, pt: 2.25, pb: 1.75 }}
        >
          <Box sx={{ minWidth: 0 }}>
            {eyebrow && (
              <Typography
                component="p"
                sx={{
                  mb: 0.45,
                  color: marketColors.cyan,
                  fontSize: "0.64rem",
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  lineHeight: 1,
                  textTransform: "uppercase",
                }}
              >
                {eyebrow}
              </Typography>
            )}
            {title && (
              <Typography
                component="h2"
                sx={{
                  color: marketColors.text,
                  fontSize: { xs: "0.98rem", sm: "1.08rem" },
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  lineHeight: 1.25,
                }}
              >
                {title}
              </Typography>
            )}
          </Box>
          {action}
        </Stack>
      )}
      <Box sx={{ minWidth: 0, ...contentSx }}>{children}</Box>
    </Box>
  );
}

export function StatusDot({ color = marketColors.demand }: { color?: string }) {
  return (
    <Box
      component="span"
      sx={{
        width: 7,
        height: 7,
        display: "inline-block",
        flex: "0 0 auto",
        borderRadius: "50%",
        bgcolor: color,
        boxShadow: `0 0 0 4px ${color}1F`,
      }}
    />
  );
}

export function formatMarketValue(value: number, precision = 2) {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(value);
}


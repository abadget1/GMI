"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import AddAlertRounded from "@mui/icons-material/AddAlertRounded";
import AssessmentRounded from "@mui/icons-material/AssessmentRounded";
import DashboardRounded from "@mui/icons-material/DashboardRounded";
import HelpOutlineRounded from "@mui/icons-material/HelpOutlineRounded";
import Inventory2Rounded from "@mui/icons-material/Inventory2Rounded";
import MenuRounded from "@mui/icons-material/MenuRounded";
import NotificationsNoneRounded from "@mui/icons-material/NotificationsNoneRounded";
import PublicRounded from "@mui/icons-material/PublicRounded";
import SearchRounded from "@mui/icons-material/SearchRounded";
import SettingsRounded from "@mui/icons-material/SettingsRounded";
import ShowChartRounded from "@mui/icons-material/ShowChartRounded";
import TuneRounded from "@mui/icons-material/TuneRounded";
import {
  Alert as MuiAlert,
  Badge,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import {
  MarketDashboardContent,
  adaptAlertsForView,
  adaptCandlesForView,
  adaptPressureForView,
  adaptZonesForView,
  demoAlerts,
  demoIndexAssets,
  demoTickers,
  marketColors,
  StatusDot,
  type ChartTimeframe,
  type MarketAlert,
} from "@/app/components/market";
import { resolveMarketEndpoints } from "@/lib/market/market-stream-adapter";
import { useMarketStream } from "@/lib/market/useMarketStream";

const SIDEBAR_WIDTH = 232;

const navigation: { label: string; icon: ReactNode; badge?: string }[] = [
  { label: "Overview", icon: <DashboardRounded /> },
  { label: "Global markets", icon: <PublicRounded /> },
  { label: "Index studio", icon: <ShowChartRounded /> },
  { label: "Supply & demand", icon: <Inventory2Rounded /> },
  { label: "Zone analyzer", icon: <AssessmentRounded /> },
  { label: "Alert center", icon: <AddAlertRounded />, badge: "3" },
];

function BrandMark() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: "relative",
        width: 31,
        height: 31,
        flex: "0 0 auto",
        border: "1px solid rgba(69,217,255,0.4)",
        borderRadius: "10px",
        background:
          "linear-gradient(145deg, rgba(69,217,255,0.18), rgba(77,225,161,0.04))",
        boxShadow: "0 0 24px rgba(69,217,255,0.12)",
      }}
    >
      <Box
        sx={{
          position: "absolute",
          left: 7,
          top: 8,
          width: 16,
          height: 13,
          borderLeft: "2px solid #45d9ff",
          borderBottom: "2px solid #45d9ff",
          transform: "skewY(-32deg)",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          right: 6,
          top: 6,
          width: 5,
          height: 5,
          bgcolor: marketColors.demand,
          borderRadius: "50%",
          boxShadow: "0 0 8px rgba(77,225,161,0.8)",
        }}
      />
    </Box>
  );
}

function SidebarContent({
  activeItem,
  onSelect,
  feedStatus,
}: {
  activeItem: string;
  onSelect: (item: string) => void;
  feedStatus: "connecting" | "connected" | "simulated";
}) {
  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        color: marketColors.text,
        bgcolor: "#071321",
        borderRight: `1px solid ${marketColors.line}`,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={1.15}
        sx={{ height: 70, px: 2.25, borderBottom: `1px solid ${marketColors.line}` }}
      >
        <BrandMark />
        <Box>
          <Typography
            sx={{
              fontSize: "0.83rem",
              fontWeight: 900,
              letterSpacing: "0.13em",
              lineHeight: 1,
            }}
          >
            MERIDIAN
          </Typography>
          <Typography
            sx={{
              mt: 0.55,
              color: marketColors.muted,
              fontSize: "0.49rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
            }}
          >
            Market intelligence
          </Typography>
        </Box>
      </Stack>

      <Box component="nav" aria-label="Primary navigation" sx={{ flex: 1, px: 1.2, py: 2 }}>
        <Typography
          sx={{
            px: 1.25,
            mb: 1,
            color: "#5f748c",
            fontSize: "0.52rem",
            fontWeight: 800,
            letterSpacing: "0.13em",
            textTransform: "uppercase",
          }}
        >
          Intelligence
        </Typography>
        <Stack spacing={0.55}>
          {navigation.map((item) => {
            const active = item.label === activeItem;
            return (
              <Button
                key={item.label}
                fullWidth
                onClick={() => onSelect(item.label)}
                startIcon={item.icon}
                aria-current={active ? "page" : undefined}
                sx={{
                  position: "relative",
                  justifyContent: "flex-start",
                  minHeight: 41,
                  px: 1.25,
                  color: active ? marketColors.text : marketColors.muted,
                  bgcolor: active ? "rgba(69,217,255,0.09)" : "transparent",
                  border: `1px solid ${active ? "rgba(69,217,255,0.18)" : "transparent"}`,
                  borderRadius: "10px",
                  fontSize: "0.64rem",
                  fontWeight: active ? 800 : 650,
                  textTransform: "none",
                  "& .MuiButton-startIcon": {
                    mr: 1.2,
                    color: active ? marketColors.cyan : "#61778f",
                    "& svg": { fontSize: 18 },
                  },
                  "&:hover": { bgcolor: "rgba(69,217,255,0.07)" },
                }}
              >
                {item.label}
                {item.badge && (
                  <Box
                    component="span"
                    sx={{
                      ml: "auto",
                      minWidth: 19,
                      height: 19,
                      display: "grid",
                      placeItems: "center",
                      color: marketColors.warning,
                      bgcolor: "rgba(255,198,109,0.1)",
                      borderRadius: "6px",
                      fontSize: "0.52rem",
                    }}
                  >
                    {item.badge}
                  </Box>
                )}
              </Button>
            );
          })}
        </Stack>
      </Box>

      <Box sx={{ p: 1.3 }}>
        <Box
          sx={{
            p: 1.35,
            bgcolor: "rgba(255,255,255,0.025)",
            border: `1px solid ${marketColors.line}`,
            borderRadius: "12px",
          }}
        >
          <Stack direction="row" alignItems="center" spacing={0.8}>
            <StatusDot
              color={
                feedStatus === "connected" ? marketColors.demand : marketColors.warning
              }
            />
            <Typography sx={{ fontSize: "0.59rem", fontWeight: 800 }}>
              {feedStatus === "connected"
                ? "API stream connected"
                : feedStatus === "connecting"
                  ? "Connecting to stream"
                  : "Deterministic demo feed"}
            </Typography>
          </Stack>
          <Typography sx={{ mt: 0.75, color: marketColors.muted, fontSize: "0.52rem", lineHeight: 1.55 }}>
            Normalized OHLC · 15m base bars
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.55} sx={{ mt: 1 }}>
          <Button
            fullWidth
            startIcon={<HelpOutlineRounded />}
            sx={{ color: marketColors.muted, fontSize: "0.55rem", textTransform: "none", "& svg": { fontSize: 15 } }}
          >
            Help
          </Button>
          <IconButton aria-label="Settings" sx={{ color: marketColors.muted }}>
            <SettingsRounded sx={{ fontSize: 17 }} />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );
}

function MethodologyFooter() {
  return (
    <Box
      component="footer"
      sx={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 1,
        mt: 2,
        px: 1,
        py: 1.4,
        color: marketColors.muted,
      }}
    >
      <Stack direction="row" alignItems="center" spacing={0.7}>
        <TuneRounded sx={{ color: marketColors.cyan, fontSize: 15 }} />
        <Typography sx={{ fontSize: "0.56rem", fontWeight: 800, color: "#a8b7c9" }}>
          Methodology v1.0
        </Typography>
      </Stack>
      {[
        "Rebased to 1,000",
        "Frozen candle weights",
        "Aligned OHLC envelope",
        "No look-ahead zones",
      ].map((label) => (
        <Chip
          key={label}
          label={label}
          size="small"
          sx={{
            height: 22,
            color: marketColors.muted,
            bgcolor: "rgba(255,255,255,0.035)",
            border: `1px solid ${marketColors.line}`,
            fontSize: "0.5rem",
          }}
        />
      ))}
      <Typography sx={{ ml: { lg: "auto" }, fontSize: "0.51rem" }}>
        Analytical prototype · Not investment advice
      </Typography>
    </Box>
  );
}

export default function Dashboard() {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [activeNavigation, setActiveNavigation] = useState("Overview");
  const [selectedSymbol, setSelectedSymbol] = useState("GMI");
  const [selectedTimeframe, setSelectedTimeframe] = useState<ChartTimeframe>("15m");
  const [alertThreshold, setAlertThreshold] = useState(0.5);
  const [alertDialogOpen, setAlertDialogOpen] = useState(false);
  const [alertSide, setAlertSide] = useState<"supply" | "demand">("demand");
  const [alertMode, setAlertMode] = useState<"approach" | "inside" | "cross">("approach");
  const [alerts, setAlerts] = useState<MarketAlert[]>([]);
  const [notice, setNotice] = useState<{ message: string; severity: "success" | "error" } | null>(null);
  const [displayTime, setDisplayTime] = useState("Synchronizing clock");

  const selectedAsset =
    demoIndexAssets.find((asset) => asset.symbol === selectedSymbol) ??
    demoIndexAssets[0];
  const feed = useMarketStream({
    symbol: selectedSymbol,
    timeframe: selectedTimeframe,
    fallbackValue: selectedAsset.value,
    fallbackChangePercent: selectedAsset.changePercent,
    candleLimit: 120,
    minZoneQuality: 45,
  });

  const marketEndpoints = useMemo(
    () =>
      resolveMarketEndpoints({
        apiUrl: process.env.NEXT_PUBLIC_MARKET_API_URL,
        wsUrl: process.env.NEXT_PUBLIC_MARKET_WS_URL,
      }),
    [],
  );

  const viewCandles = useMemo(() => adaptCandlesForView(feed.candles), [feed.candles]);
  const viewZones = useMemo(() => adaptZonesForView(feed.zones), [feed.zones]);
  const viewHeatmap = useMemo(() => adaptPressureForView(feed.pressure), [feed.pressure]);
  const visibleAlerts = useMemo(() => {
    const demoFeedAlerts = feed.source === "demo" ? demoAlerts : [];
    const combined = [
      ...adaptAlertsForView(feed.alerts),
      ...alerts,
      ...demoFeedAlerts,
    ];
    return Array.from(new Map(combined.map((alert) => [alert.id, alert])).values()).slice(0, 8);
  }, [alerts, feed.alerts, feed.source]);

  useEffect(() => {
    const updateClock = () => {
      setDisplayTime(
        new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          second: "2-digit",
          timeZoneName: "short",
        }).format(new Date()),
      );
    };
    updateClock();
    const timer = setInterval(updateClock, 1_000);
    return () => clearInterval(timer);
  }, []);

  const liveTickers = useMemo(
    () =>
      demoTickers.map((ticker) =>
        ticker.symbol === selectedSymbol
          ? {
              ...ticker,
              value: feed.currentValue,
              changePercent: feed.changePercent,
              change: (feed.currentValue * feed.changePercent) / 100,
            }
          : ticker,
      ),
    [feed.changePercent, feed.currentValue, selectedSymbol],
  );

  const chooseNavigation = (item: string) => {
    setActiveNavigation(item);
    setMobileNavOpen(false);
  };

  const createAlert = async () => {
    const apiBase = marketEndpoints.apiBaseUrl;
    try {
      if (apiBase) {
        const response = await fetch(`${apiBase}/alerts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            symbol: selectedSymbol,
            zone_side: alertSide,
            mode: alertMode,
            timeframe: selectedTimeframe.toLowerCase(),
            threshold_pct: alertThreshold,
            cooldown_seconds: 300,
          }),
        });
        if (!response.ok) throw new Error(`API returned ${response.status}`);
      }

      const condition: MarketAlert["condition"] =
        alertMode === "cross" ? "crossed" : alertMode === "inside" ? "inside" : "approaching";
      setAlerts((current) => [
        {
          id: `rule-${Date.now()}`,
          symbol: selectedSymbol,
          zoneType: alertSide,
          condition,
          thresholdPercent: alertThreshold,
          currentDistancePercent: alertMode === "inside" ? 0 : alertThreshold,
          triggeredAt: "Armed now",
          armed: true,
        },
        ...current,
      ]);
      setAlertDialogOpen(false);
      setNotice({
        message: `${selectedSymbol} ${selectedTimeframe.toUpperCase()} ${alertMode} alert armed`,
        severity: "success",
      });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? `Could not create alert: ${error.message}` : "Could not create alert",
        severity: "error",
      });
    }
  };

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: marketColors.ink }}>
      <Box
        component="aside"
        sx={{
          position: "fixed",
          inset: "0 auto 0 0",
          zIndex: 30,
          display: { xs: "none", lg: "block" },
          width: SIDEBAR_WIDTH,
        }}
      >
        <SidebarContent
          activeItem={activeNavigation}
          onSelect={chooseNavigation}
          feedStatus={feed.status}
        />
      </Box>

      <Drawer
        anchor="left"
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: "min(86vw, 268px)",
              bgcolor: "#071321",
              backgroundImage: "none",
            },
          },
        }}
      >
        <SidebarContent
          activeItem={activeNavigation}
          onSelect={chooseNavigation}
          feedStatus={feed.status}
        />
      </Drawer>

      <Box sx={{ ml: { xs: 0, lg: `${SIDEBAR_WIDTH}px` }, minWidth: 0 }}>
        <Box
          component="header"
          sx={{
            position: "sticky",
            top: 0,
            zIndex: 20,
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            height: 70,
            px: { xs: 1.5, sm: 2.5, xl: 3.5 },
            bgcolor: "rgba(7,17,31,0.86)",
            borderBottom: `1px solid ${marketColors.line}`,
            backdropFilter: "blur(18px)",
          }}
        >
          <IconButton
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation"
            sx={{ display: { xs: "inline-flex", lg: "none" }, color: marketColors.text }}
          >
            <MenuRounded />
          </IconButton>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ display: { xs: "flex", lg: "none" } }}>
            <BrandMark />
          </Stack>

          <Box
            sx={{
              display: { xs: "none", md: "flex" },
              alignItems: "center",
              width: "min(36vw, 390px)",
              height: 36,
              px: 1.25,
              bgcolor: "rgba(255,255,255,0.035)",
              border: `1px solid ${marketColors.line}`,
              borderRadius: "10px",
            }}
          >
            <SearchRounded sx={{ mr: 1, color: "#63788f", fontSize: 18 }} />
            <Box
              component="input"
              aria-label="Search markets"
              placeholder="Search market, sector, or zone"
              sx={{
                width: "100%",
                color: marketColors.text,
                bgcolor: "transparent",
                border: 0,
                outline: 0,
                fontSize: "0.61rem",
                "&::placeholder": { color: "#60748b", opacity: 1 },
              }}
            />
            <Typography sx={{ color: "#52687f", fontSize: "0.52rem", whiteSpace: "nowrap" }}>
              ⌘ K
            </Typography>
          </Box>

          <Box sx={{ flex: 1 }} />
          <Stack
            direction="row"
            alignItems="center"
            spacing={0.8}
            sx={{ display: { xs: "none", sm: "flex" } }}
          >
            <StatusDot
              color={feed.status === "connected" ? marketColors.demand : marketColors.warning}
            />
            <Typography sx={{ color: "#a7b6c8", fontSize: "0.56rem", fontWeight: 700 }}>
              {feed.status === "connected" ? "Live API" : "Demo stream"}
            </Typography>
          </Stack>
          <Typography
            suppressHydrationWarning
            sx={{ display: { xs: "none", md: "block" }, color: marketColors.muted, fontSize: "0.54rem" }}
          >
            {displayTime}
          </Typography>
          <IconButton aria-label="Notifications" sx={{ color: marketColors.muted }}>
            <Badge
              color="error"
              variant="dot"
              overlap="circular"
              sx={{ "& .MuiBadge-badge": { bgcolor: marketColors.warning } }}
            >
              <NotificationsNoneRounded sx={{ fontSize: 20 }} />
            </Badge>
          </IconButton>
          <Box
            aria-label="User profile"
            sx={{
              width: 31,
              height: 31,
              display: "grid",
              placeItems: "center",
              color: "#05111e",
              bgcolor: "#d7e8f5",
              borderRadius: "10px",
              fontSize: "0.6rem",
              fontWeight: 900,
            }}
          >
            AM
          </Box>
        </Box>

        <Box
          component="main"
          sx={{
            width: "100%",
            maxWidth: 1880,
            mx: "auto",
            px: { xs: 1.25, sm: 2, xl: 3 },
            py: { xs: 2, sm: 2.6 },
          }}
        >
          <Stack
            direction={{ xs: "column", sm: "row" }}
            alignItems={{ xs: "flex-start", sm: "flex-end" }}
            justifyContent="space-between"
            spacing={1.3}
            sx={{ mb: 2.2, px: 0.4 }}
          >
            <Box>
              <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 0.75 }}>
                <Typography sx={{ color: marketColors.cyan, fontSize: "0.52rem", fontWeight: 850, letterSpacing: "0.13em", textTransform: "uppercase" }}>
                  Global pulse
                </Typography>
                <Box sx={{ width: 22, height: 1, bgcolor: "rgba(69,217,255,0.45)" }} />
                <Typography sx={{ color: marketColors.muted, fontSize: "0.52rem" }}>
                  Sequence {feed.sequence.toLocaleString()}
                </Typography>
              </Stack>
              <Typography
                component="h1"
                sx={{
                  m: 0,
                  fontSize: { xs: "1.45rem", sm: "1.8rem" },
                  fontWeight: 760,
                  letterSpacing: "-0.045em",
                }}
              >
                Market intelligence overview
              </Typography>
              <Typography sx={{ mt: 0.65, color: marketColors.muted, fontSize: { xs: "0.62rem", sm: "0.68rem" } }}>
                Composite indices, physical flows, structural zones, and alert proximity in one view.
              </Typography>
            </Box>
            <Stack direction="row" alignItems="center" spacing={0.8}>
              <Chip
                icon={<StatusDot color={marketColors.demand} />}
                label={`${feed.latencyMs}ms latency`}
                size="small"
                sx={{
                  height: 27,
                  color: "#a7b6c8",
                  bgcolor: "rgba(255,255,255,0.035)",
                  border: `1px solid ${marketColors.line}`,
                  fontSize: "0.53rem",
                  "& .MuiChip-icon": { ml: 1 },
                }}
              />
              <Button
                startIcon={<AddAlertRounded />}
                onClick={() => setAlertDialogOpen(true)}
                sx={{
                  height: 30,
                  px: 1.35,
                  color: "#03131e",
                  bgcolor: marketColors.cyan,
                  borderRadius: "8px",
                  fontSize: "0.56rem",
                  fontWeight: 850,
                  textTransform: "none",
                  "&:hover": { bgcolor: "#72e4ff" },
                  "& svg": { fontSize: "15px !important" },
                }}
              >
                New alert
              </Button>
            </Stack>
          </Stack>

          <MarketDashboardContent
            tickers={liveTickers}
            assetOptions={demoIndexAssets}
            selectedSymbol={selectedSymbol}
            currentValue={feed.currentValue}
            change={(feed.currentValue * feed.changePercent) / 100}
            changePercent={feed.changePercent}
            alertThreshold={alertThreshold}
            alerts={visibleAlerts}
            candles={viewCandles}
            zones={viewZones}
            heatmap={viewHeatmap}
            timeframe={selectedTimeframe}
            onAssetChange={setSelectedSymbol}
            onAlertThresholdChange={setAlertThreshold}
            onTimeframeChange={setSelectedTimeframe}
            onCreateAlert={() => setAlertDialogOpen(true)}
            dataQuality={99.4}
            latencyMs={feed.latencyMs}
          />
          <MethodologyFooter />
        </Box>
      </Box>

      <Dialog
        open={alertDialogOpen}
        onClose={() => setAlertDialogOpen(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{
          sx: {
            color: marketColors.text,
            bgcolor: "#0b1a2a",
            backgroundImage: "none",
            border: `1px solid ${marketColors.line}`,
            borderRadius: "16px",
          },
        }}
      >
        <DialogTitle sx={{ fontSize: "1rem", fontWeight: 850 }}>Create zone alert</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2, color: marketColors.muted, fontSize: "0.68rem", lineHeight: 1.6 }}>
            Arm a {selectedSymbol} rule on the active {selectedTimeframe.toUpperCase()} timeframe at the ±{alertThreshold.toFixed(1)}% threshold.
          </Typography>
          <Stack spacing={1.5}>
            <FormControl fullWidth size="small">
              <InputLabel id="zone-side-label">Zone side</InputLabel>
              <Select
                labelId="zone-side-label"
                value={alertSide}
                label="Zone side"
                onChange={(event) => setAlertSide(event.target.value as "supply" | "demand")}
              >
                <MenuItem value="demand">Demand</MenuItem>
                <MenuItem value="supply">Supply</MenuItem>
              </Select>
            </FormControl>
            <FormControl fullWidth size="small">
              <InputLabel id="alert-mode-label">Trigger</InputLabel>
              <Select
                labelId="alert-mode-label"
                value={alertMode}
                label="Trigger"
                onChange={(event) => setAlertMode(event.target.value as "approach" | "inside" | "cross")}
              >
                <MenuItem value="approach">Approach threshold</MenuItem>
                <MenuItem value="inside">Inside zone</MenuItem>
                <MenuItem value="cross">Boundary crossing</MenuItem>
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setAlertDialogOpen(false)} sx={{ color: marketColors.muted }}>Cancel</Button>
          <Button onClick={createAlert} variant="contained" sx={{ color: "#03131e", bgcolor: marketColors.cyan, fontWeight: 850 }}>
            Arm alert
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(notice)} autoHideDuration={4200} onClose={() => setNotice(null)}>
        <MuiAlert severity={notice?.severity ?? "success"} variant="filled" onClose={() => setNotice(null)}>
          {notice?.message}
        </MuiAlert>
      </Snackbar>
    </Box>
  );
}

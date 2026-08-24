"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import AddAlertRounded from "@mui/icons-material/AddAlertRounded";
import AssessmentRounded from "@mui/icons-material/AssessmentRounded";
import DashboardRounded from "@mui/icons-material/DashboardRounded";
import FileUploadRounded from "@mui/icons-material/FileUploadRounded";
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
  TextField,
  Typography,
} from "@mui/material";
import {
  MarketDashboardContent,
  MarketControlBar,
  adaptAlertsForView,
  adaptCandlesForView,
  adaptPressureForView,
  adaptZonesForView,
  marketColors,
  StatusDot,
  type ChartTimeframe,
  type HeatmapMetric,
  type IndexAssetOption,
  type MarketAlert,
} from "@/app/components/market";
import {
  calculateDataQuality,
  deriveActivityRegions,
  deriveHistoricalHeatmap,
  deriveMarketAnalytics,
  deriveWatchlistAssets,
} from "@/app/components/market/analytics";
import MarketWorkspaceView, {
  type MarketWorkspaceViewName,
} from "@/app/components/market/MarketWorkspaceViews";
import {
  deriveClientHistoricalZones,
  parseClientHistoricalImport,
} from "@/lib/market/client-historical-import";
import {
  resolveMarketEndpoints,
  type MarketStreamCandle,
  type MarketStreamZone,
} from "@/lib/market/market-stream-adapter";
import { useMarketStream } from "@/lib/market/useMarketStream";

const SIDEBAR_WIDTH = 232;

interface LocalHistoricalDataset {
  asset: IndexAssetOption;
  timeframe: ChartTimeframe;
  candles: MarketStreamCandle[];
  zones: MarketStreamZone[];
  importedAt: Date;
  rowsReceived: number;
}

function localDatasetKey(symbol: string, timeframe: ChartTimeframe): string {
  return `${symbol.trim().toUpperCase()}::${timeframe}`;
}

interface HistoricalAssetResponse {
  symbol: string;
  name?: string;
  asset_class?: string;
  latest_close?: number;
  provider?: string;
  price_basis?: string;
  supported_timeframes?: ChartTimeframe[];
  timeframes?: ChartTimeframe[];
}

interface AlphaBoardItem {
  symbol: string;
  name?: string;
  asset_class?: string;
  price?: number;
  change_percent?: number;
}

function alphaBoardMetric(item: AlphaBoardItem): HeatmapMetric | null {
  if (!item.symbol || typeof item.price !== "number" || !Number.isFinite(item.price)) return null;
  const change = typeof item.change_percent === "number" && Number.isFinite(item.change_percent)
    ? item.change_percent
    : 0;
  const group: HeatmapMetric["group"] = item.asset_class === "commodity"
    ? item.symbol === "COPPER" ? "Industrial metals" : item.symbol === "WHEAT" ? "Agriculture" : "Energy"
    : "Momentum";
  return {
    id: `alpha-${item.symbol}`,
    name: item.name?.trim() || item.symbol,
    ticker: item.symbol,
    group,
    pressure: Math.max(-100, Math.min(100, change * 20)),
    changePercent: change,
    flowLabel: `${item.price < 10 ? item.price.toFixed(4) : item.price.toFixed(2)} live`,
  };
}

function historicalAssetOption(asset: HistoricalAssetResponse): IndexAssetOption {
  const latestClose = asset.latest_close;
  const isAlphaVantage = asset.provider === "alpha_vantage";
  const assetClass = ["index", "forex", "commodity", "crypto", "custom"].includes(asset.asset_class ?? "")
    ? asset.asset_class as IndexAssetOption["assetClass"]
    : "custom";
  return {
    symbol: asset.symbol.toUpperCase(),
    name: asset.name?.trim() || asset.symbol.toUpperCase(),
    value: typeof latestClose === "number" && Number.isFinite(latestClose) && latestClose > 0 ? latestClose : 0,
    change: 0,
    changePercent: 0,
    method: isAlphaVantage
      ? `Alpha Vantage · ${assetClass}`
      : `Historical import${asset.asset_class ? ` · ${asset.asset_class}` : ""}`,
    componentCount: 0,
    assetClass,
    dataSource: isAlphaVantage ? "alpha_vantage" : "historical_import",
    priceBasis: asset.price_basis,
    supportedTimeframes: asset.timeframes ?? asset.supported_timeframes,
  };
}

const navigation: { label: string; icon: ReactNode }[] = [
  { label: "Overview", icon: <DashboardRounded /> },
  { label: "Global markets", icon: <PublicRounded /> },
  { label: "Index studio", icon: <ShowChartRounded /> },
  { label: "Supply & demand", icon: <Inventory2Rounded /> },
  { label: "Zone analyzer", icon: <AssessmentRounded /> },
  { label: "Alert center", icon: <AddAlertRounded /> },
];

const pageMetadata: Record<string, { eyebrow: string; title: string; description: string }> = {
  Overview: {
    eyebrow: "Global pulse",
    title: "Market intelligence overview",
    description: "Composite indices, physical flows, structural zones, and alert proximity in one view.",
  },
  "Global markets": {
    eyebrow: "Cross-market monitor",
    title: "Global markets",
    description: "Compare session activity, synchronized performance, volume, and regime signals.",
  },
  "Index studio": {
    eyebrow: "Quant workspace",
    title: "Index studio",
    description: "Inspect the selected series, normalized performance, return shape, and range statistics.",
  },
  "Supply & demand": {
    eyebrow: "Flow intelligence",
    title: "Supply & demand",
    description: "Read momentum, volume, structural pressure, and active price zones from one dataset.",
  },
  "Zone analyzer": {
    eyebrow: "Structure engine",
    title: "Zone analyzer",
    description: "Validate zone quality, freshness, structural evidence, and distance to price.",
  },
  "Alert center": {
    eyebrow: "Signal operations",
    title: "Alert center",
    description: "Monitor armed rules and triggered proximity events for the selected market.",
  },
};

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
  alertCount,
  timeframe,
  isImported,
  onOpenHelp,
  onOpenSettings,
}: {
  activeItem: string;
  onSelect: (item: string) => void;
  feedStatus: "connecting" | "connected" | "unavailable";
  alertCount: number;
  timeframe: ChartTimeframe;
  isImported: boolean;
  onOpenHelp: () => void;
  onOpenSettings: () => void;
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
                {item.label === "Alert center" && alertCount > 0 && (
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
                    {alertCount > 99 ? "99+" : alertCount}
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
              {isImported
                ? "Uploaded dataset ready"
                : feedStatus === "connected"
                  ? "API stream connected"
                : feedStatus === "connecting"
                  ? "Connecting to stream"
                  : "API unavailable"}
            </Typography>
          </Stack>
          <Typography sx={{ mt: 0.75, color: marketColors.muted, fontSize: "0.52rem", lineHeight: 1.55 }}>
            {timeframe.toUpperCase()} · synchronized OHLCV
          </Typography>
        </Box>
        <Stack direction="row" spacing={0.55} sx={{ mt: 1 }}>
          <Button
            fullWidth
            startIcon={<HelpOutlineRounded />}
            onClick={onOpenHelp}
            sx={{ color: marketColors.muted, fontSize: "0.55rem", textTransform: "none", "& svg": { fontSize: 15 } }}
          >
            Help
          </Button>
          <IconButton aria-label="Settings" onClick={onOpenSettings} sx={{ color: marketColors.muted }}>
            <SettingsRounded sx={{ fontSize: 17 }} />
          </IconButton>
        </Stack>
      </Box>
    </Box>
  );
}

function MethodologyFooter({
  isImported,
  timeframe,
  barCount,
}: {
  isImported: boolean;
  timeframe: ChartTimeframe;
  barCount: number;
}) {
  const methodologyLabels = isImported
    ? [
        `${barCount.toLocaleString()} validated bars`,
        `${timeframe.toUpperCase()} source interval`,
        "Last-row duplicate resolution",
        "No look-ahead zones",
      ]
    : [
        "Rebased to 1,000",
        "Frozen candle weights",
        "Aligned OHLC envelope",
        "No look-ahead zones",
      ];
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
      {methodologyLabels.map((label) => (
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
  const [uploadedAssets, setUploadedAssets] = useState<IndexAssetOption[]>([]);
  const [alphaHeatmap, setAlphaHeatmap] = useState<HeatmapMetric[]>([]);
  const [localDatasets, setLocalDatasets] = useState<Record<string, LocalHistoricalDataset>>({});
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSymbol, setUploadSymbol] = useState("");
  const [uploadName, setUploadName] = useState("");
  const [uploadTimeframe, setUploadTimeframe] = useState<ChartTimeframe>("1d");
  const [isUploading, setIsUploading] = useState(false);
  const [notice, setNotice] = useState<{ message: string; severity: "success" | "error" } | null>(null);
  const [displayTime, setDisplayTime] = useState("Synchronizing clock");
  const [searchQuery, setSearchQuery] = useState("");
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const assetOptions = useMemo(() => {
    return uploadedAssets;
  }, [uploadedAssets]);

  const selectedAsset =
    assetOptions.find((asset) => asset.symbol === selectedSymbol) ??
    assetOptions[0] ??
    {
      symbol: selectedSymbol,
      name: selectedSymbol,
      value: 0,
      change: 0,
      changePercent: 0,
      method: "Waiting for API data",
      componentCount: 0,
      assetClass: "custom" as const,
      dataSource: "alpha_vantage" as const,
    };
  const isRestOnlyAsset = selectedAsset.dataSource === "alpha_vantage" || selectedAsset.dataSource === "historical_import";
  const handleResolvedTimeframe = useCallback((timeframe: ChartTimeframe) => {
    setSelectedTimeframe((current) => current === timeframe ? current : timeframe);
  }, []);
  const streamedFeed = useMarketStream({
    symbol: selectedSymbol,
    timeframe: selectedTimeframe,
    fallbackValue: selectedAsset.value,
    fallbackChangePercent: selectedAsset.changePercent,
    candleLimit: 120,
    minZoneQuality: 45,
    wsUrl: isRestOnlyAsset ? null : undefined,
    preferRestCandles: isRestOnlyAsset,
    restRefreshIntervalMs: 60_000,
    onTimeframeResolved: handleResolvedTimeframe,
  });

  const localDataset = localDatasets[localDatasetKey(selectedSymbol, selectedTimeframe)];
  const feed = useMemo(() => {
    if (!localDataset) {
      // The stream hook resets on symbol/timeframe changes. During that
      // hand-off, hide the previous series instead of briefly labeling it as
      // the newly selected asset.
      if (streamedFeed.symbol === selectedSymbol && streamedFeed.timeframe === selectedTimeframe) {
        return streamedFeed;
      }
      return {
        ...streamedFeed,
        symbol: selectedSymbol,
        timeframe: selectedTimeframe,
        currentValue: selectedAsset.value,
        changePercent: selectedAsset.changePercent,
        updatedAt: null,
        isLoading: true,
        error: null,
        candles: [],
        zones: [],
        pressure: [],
        alerts: [],
      };
    }
    const latest = localDataset.candles.at(-1);
    const previous = localDataset.candles.at(-2);
    const currentValue = latest?.close ?? selectedAsset.value;
    const changePercent = previous?.close
      ? ((currentValue / previous.close) - 1) * 100
      : 0;
    return {
      ...streamedFeed,
      symbol: selectedSymbol,
      timeframe: localDataset.timeframe,
      currentValue,
      changePercent,
      status: "connected" as const,
      source: "upload" as const,
      latencyMs: 0,
      sequence: localDataset.candles.length,
      updatedAt: localDataset.importedAt,
      isLoading: false,
      error: null,
      candles: localDataset.candles.slice(-120),
      zones: localDataset.zones,
      pressure: [],
      alerts: [],
    };
  }, [localDataset, selectedAsset.changePercent, selectedAsset.value, selectedSymbol, selectedTimeframe, streamedFeed]);

  const marketEndpoints = useMemo(
    () =>
      resolveMarketEndpoints({
        apiUrl: process.env.NEXT_PUBLIC_MARKET_API_URL ?? process.env.NEXT_PUBLIC_GMI_API_URL,
        wsUrl:
          (process.env.NEXT_PUBLIC_MARKET_WS_URL ?? process.env.NEXT_PUBLIC_GMI_WS_URL)?.trim() ||
          null,
      }),
    [],
  );

  useEffect(() => {
    const apiBase = marketEndpoints.apiBaseUrl;
    if (!apiBase) return;
    const controller = new AbortController();
    fetch(`${apiBase}/assets`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`API returned ${response.status}`);
        return response.json() as Promise<{
          asset_catalog?: HistoricalAssetResponse[];
          live_assets?: HistoricalAssetResponse[];
          imported_assets?: HistoricalAssetResponse[];
        }>;
      })
      .then((payload) => {
        if (!controller.signal.aborted) {
          const assets = [
            ...(Array.isArray(payload.asset_catalog) ? payload.asset_catalog : []),
            ...(Array.isArray(payload.live_assets) ? payload.live_assets : []),
            ...(Array.isArray(payload.imported_assets) ? payload.imported_assets : []),
          ];
          setUploadedAssets((current) => {
            const merged = new Map(current.map((asset) => [asset.symbol, asset]));
            assets.map(historicalAssetOption).forEach((asset) => merged.set(asset.symbol, asset));
            return Array.from(merged.values());
          });
        }
      })
      .catch(() => {
        // The dashboard remains fully functional when the optional API is absent.
      });
    return () => controller.abort();
  }, [marketEndpoints.apiBaseUrl]);

  useEffect(() => {
    const apiBase = marketEndpoints.apiBaseUrl;
    if (!apiBase) return;
    const controller = new AbortController();
    fetch(`${apiBase}/alpha/board?asset_class=commodity&limit=5`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Alpha board returned ${response.status}`);
        return response.json() as Promise<{ items?: AlphaBoardItem[] }>;
      })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setAlphaHeatmap(
          (Array.isArray(payload.items) ? payload.items : [])
            .map(alphaBoardMetric)
            .filter((metric): metric is HeatmapMetric => metric !== null),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setAlphaHeatmap([]);
      });
    return () => controller.abort();
  }, [marketEndpoints.apiBaseUrl]);

  const viewCandles = useMemo(() => adaptCandlesForView(feed.candles), [feed.candles]);
  const viewZones = useMemo(() => adaptZonesForView(feed.zones), [feed.zones]);
  const globalHeatmap = useMemo(() => adaptPressureForView(feed.pressure), [feed.pressure]);
  const analytics = useMemo(
    () => deriveMarketAnalytics(viewCandles, feed.timeframe),
    [feed.timeframe, viewCandles],
  );
  const historicalHeatmap = useMemo(
    () => deriveHistoricalHeatmap(viewCandles, viewZones, selectedSymbol),
    [selectedSymbol, viewCandles, viewZones],
  );
  const synchronizedHeatmap = alphaHeatmap.length > 0
    ? alphaHeatmap
    : selectedAsset.dataSource === "historical_import" || feed.source === "upload"
    ? historicalHeatmap
    : globalHeatmap.length > 0
      ? globalHeatmap
      : historicalHeatmap;
  const synchronizedRegions = useMemo(() => deriveActivityRegions(viewCandles), [viewCandles]);
  const derivedWatchlist = useMemo(
    () => deriveWatchlistAssets(assetOptions, selectedSymbol, viewCandles, viewZones),
    [assetOptions, selectedSymbol, viewCandles, viewZones],
  );
  const synchronizedWatchlist = selectedAsset.dataSource === "historical_import" || feed.source === "upload"
    ? derivedWatchlist.filter((asset) => asset.symbol === selectedSymbol)
    : derivedWatchlist;
  const dataQuality = useMemo(() => calculateDataQuality(viewCandles), [viewCandles]);
  const quoteChange = viewCandles.length > 1
    ? viewCandles[viewCandles.length - 1].close - viewCandles[viewCandles.length - 2].close
    : 0;
  const lastUpdatedLabel = feed.updatedAt
    ? `Updated ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(feed.updatedAt)}`
    : "Awaiting first update";
  const allAlerts = useMemo(() => {
    const combined = [
      ...adaptAlertsForView(feed.alerts),
      ...alerts,
    ];
    return Array.from(new Map(combined.map((alert) => [alert.id, alert])).values());
  }, [alerts, feed.alerts]);
  const visibleAlerts = allAlerts.slice(0, 8);

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

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const liveTickers = useMemo(
    () => {
      if (selectedAsset.dataSource === "historical_import" || feed.source === "upload") {
        return [{
          symbol: selectedSymbol,
          name: selectedAsset.name,
          value: feed.currentValue,
          changePercent: feed.changePercent,
          change: quoteChange,
          precision: feed.currentValue < 10 ? 4 : 2,
          session: `${feed.timeframe.toUpperCase()} uploaded series`,
        }];
      }
      if (!Number.isFinite(feed.currentValue) || feed.currentValue <= 0) return [];
      return [
        {
          symbol: selectedSymbol,
          name: selectedAsset.name,
          value: feed.currentValue,
          changePercent: feed.changePercent,
          change: (feed.currentValue * feed.changePercent) / 100,
          precision: feed.currentValue < 10 ? 4 : 2,
        },
      ];
    },
    [feed.changePercent, feed.currentValue, feed.source, feed.timeframe, quoteChange, selectedAsset.dataSource, selectedAsset.name, selectedSymbol],
  );

  const availableTimeframes = selectedAsset.supportedTimeframes?.length
    ? selectedAsset.supportedTimeframes
    : (["15m", "30m", "1h", "4h", "1d"] as ChartTimeframe[]);

  const chooseAsset = useCallback((symbol: string) => {
    const nextAsset = assetOptions.find((asset) => asset.symbol === symbol);
    setSelectedSymbol(symbol);
    if (
      nextAsset?.supportedTimeframes?.length &&
      !nextAsset.supportedTimeframes.includes(selectedTimeframe)
    ) {
      setSelectedTimeframe(nextAsset.supportedTimeframes.at(-1) ?? "1d");
    }
  }, [assetOptions, selectedTimeframe]);

  const submitSearch = () => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return;
    const match = assetOptions.find((asset) =>
      asset.symbol.toLowerCase() === query || asset.name.toLowerCase().includes(query),
    );
    if (!match) {
      setNotice({ message: `No market matched “${searchQuery.trim()}”`, severity: "error" });
      return;
    }
    chooseAsset(match.symbol);
    setActiveNavigation("Index studio");
    setSearchQuery("");
  };

  const chooseNavigation = (item: string) => {
    setActiveNavigation(item);
    setMobileNavOpen(false);
  };

  const createAlert = async () => {
    const apiBase = marketEndpoints.apiBaseUrl;
    try {
      let synchronizedToApi = false;
      if (apiBase) {
        try {
          const response = await fetch(`${apiBase}/alerts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              symbol: selectedSymbol,
              zone_side: alertSide,
              mode: alertMode,
              timeframe: feed.timeframe,
              threshold_pct: alertThreshold,
              cooldown_seconds: 300,
            }),
          });
          if (!response.ok) throw new Error(`API returned ${response.status}`);
          synchronizedToApi = true;
        } catch (error) {
          if (feed.source !== "upload") throw error;
        }
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
        message: `${selectedSymbol} ${feed.timeframe.toUpperCase()} ${alertMode} alert armed${apiBase && !synchronizedToApi ? " in this browser session" : ""}`,
        severity: "success",
      });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? `Could not create alert: ${error.message}` : "Could not create alert",
        severity: "error",
      });
    }
  };

  const importHistoricalData = async () => {
    const apiBase = marketEndpoints.apiBaseUrl;
    const symbol = uploadSymbol.trim().toUpperCase();
    if (!uploadFile) {
      setNotice({ message: "Choose a CSV or JSON OHLCV file first", severity: "error" });
      return;
    }
    if (uploadFile.size > 10 * 1024 * 1024) {
      setNotice({ message: "Historical imports are limited to 10 MB", severity: "error" });
      return;
    }
    if (!/^[A-Z0-9._:/-]{1,32}$/.test(symbol)) {
      setNotice({ message: "Use a symbol with letters, numbers, ., _, :, /, or -", severity: "error" });
      return;
    }

    setIsUploading(true);
    try {
      const extension = uploadFile.name.split(".").pop()?.toLowerCase();
      const sourceFormat = extension === "json" ? "json" : "csv";
      const fileText = await uploadFile.text();
      const parsedCandles = parseClientHistoricalImport({
        text: fileText,
        format: sourceFormat,
        symbol,
        timeframe: uploadTimeframe,
      });
      const retainedCandles = parsedCandles.slice(-500);
      const localZones = deriveClientHistoricalZones(retainedCandles)
        .filter((zone) => zone.qualityScore >= 45)
        .slice(-20);
      const previousAsset = assetOptions.find((asset) => asset.symbol === symbol);
      const supportedTimeframes = Array.from(new Set([
        ...(previousAsset?.supportedTimeframes ?? []),
        uploadTimeframe,
      ])).sort((left, right) =>
        (["15m", "30m", "1h", "4h", "1d"] as ChartTimeframe[]).indexOf(left) -
        (["15m", "30m", "1h", "4h", "1d"] as ChartTimeframe[]).indexOf(right),
      );
      let imported: IndexAssetOption = {
        symbol,
        name: uploadName.trim() || previousAsset?.name || symbol,
        value: retainedCandles.at(-1)?.close ?? 1_000,
        change: retainedCandles.length > 1
          ? retainedCandles[retainedCandles.length - 1].close - retainedCandles[retainedCandles.length - 2].close
          : 0,
        changePercent: retainedCandles.length > 1
          ? ((retainedCandles[retainedCandles.length - 1].close / retainedCandles[retainedCandles.length - 2].close) - 1) * 100
          : 0,
        method: "Historical import · browser validated",
        componentCount: 0,
        assetClass: "custom",
        dataSource: "historical_import",
        priceBasis: "Uploaded OHLCV",
        supportedTimeframes,
      };
      let apiSyncMessage = "browser session";

      if (apiBase) {
        try {
          const params = new URLSearchParams({
            symbol,
            timeframe: uploadTimeframe,
            mode: "replace",
            format: sourceFormat,
          });
          if (uploadName.trim()) params.set("name", uploadName.trim());
          const response = await fetch(`${apiBase}/historical/import?${params.toString()}`, {
            method: "POST",
            headers: { "Content-Type": sourceFormat === "json" ? "application/json" : "text/csv" },
            body: fileText,
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(
              typeof payload.detail === "string" ? payload.detail : `API returned ${response.status}`,
            );
          }
          const apiAsset = historicalAssetOption(payload.asset as HistoricalAssetResponse);
          imported = {
            ...imported,
            ...apiAsset,
            supportedTimeframes: apiAsset.supportedTimeframes ?? supportedTimeframes,
          };
          apiSyncMessage = `API synchronized · ${payload.rows_retained ?? retainedCandles.length} retained`;
        } catch {
          apiSyncMessage = "browser session · API sync unavailable";
        }
      }

      const importedAt = new Date();
      setLocalDatasets((current) => ({
        ...current,
        [localDatasetKey(symbol, uploadTimeframe)]: {
          asset: imported,
          timeframe: uploadTimeframe,
          candles: retainedCandles,
          zones: localZones,
          importedAt,
          rowsReceived: parsedCandles.length,
        },
      }));
      setUploadedAssets((current) => {
        const next = new Map(current.map((asset) => [asset.symbol, asset]));
        next.set(imported.symbol, imported);
        return Array.from(next.values());
      });
      setSelectedSymbol(imported.symbol);
      setSelectedTimeframe(uploadTimeframe);
      setUploadDialogOpen(false);
      setUploadFile(null);
      setNotice({
        message: `${imported.symbol}: ${parsedCandles.length.toLocaleString()} bars loaded · ${apiSyncMessage}`,
        severity: "success",
      });
    } catch (error) {
      setNotice({
        message: error instanceof Error ? `Could not import data: ${error.message}` : "Could not import data",
        severity: "error",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const activePage = pageMetadata[activeNavigation] ?? pageMetadata.Overview;

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
          alertCount={allAlerts.length}
          timeframe={feed.timeframe}
          isImported={selectedAsset.dataSource === "historical_import" || feed.source === "upload"}
          onOpenHelp={() => setHelpDialogOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
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
          alertCount={allAlerts.length}
          timeframe={feed.timeframe}
          isImported={selectedAsset.dataSource === "historical_import" || feed.source === "upload"}
          onOpenHelp={() => setHelpDialogOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
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
              ref={searchInputRef}
              aria-label="Search markets"
              placeholder="Search market, sector, or zone"
              value={searchQuery}
              onChange={(event) => setSearchQuery((event.target as HTMLInputElement).value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitSearch();
              }}
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
              {feed.source === "upload" ? "Uploaded data" : feed.status === "connected" ? "Live API" : feed.status === "connecting" ? "Connecting to API" : "API unavailable"}
            </Typography>
          </Stack>
          <Typography
            suppressHydrationWarning
            sx={{ display: { xs: "none", md: "block" }, color: marketColors.muted, fontSize: "0.54rem" }}
          >
            {displayTime}
          </Typography>
          <IconButton
            aria-label="Open alert center"
            onClick={() => chooseNavigation("Alert center")}
            sx={{ color: marketColors.muted }}
          >
            <Badge
              color="error"
              variant="dot"
              invisible={allAlerts.length === 0}
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
            {activeNavigation === "Overview" && <Box>
              <Stack direction="row" alignItems="center" spacing={0.8} sx={{ mb: 0.75 }}>
                <Typography sx={{ color: marketColors.cyan, fontSize: "0.52rem", fontWeight: 850, letterSpacing: "0.13em", textTransform: "uppercase" }}>
                  {activePage.eyebrow}
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
                {activePage.title}
              </Typography>
              <Typography sx={{ mt: 0.65, color: marketColors.muted, fontSize: { xs: "0.62rem", sm: "0.68rem" } }}>
                {activePage.description}
              </Typography>
            </Box>}
            <Stack direction="row" alignItems="center" spacing={0.8} sx={{ ml: { sm: activeNavigation === "Overview" ? 0 : "auto" } }}>
              <Chip
                icon={<StatusDot color={marketColors.demand} />}
                label={feed.source === "upload" ? "Local dataset" : `${feed.latencyMs}ms latency`}
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
                startIcon={<FileUploadRounded />}
                onClick={() => setUploadDialogOpen(true)}
                sx={{
                  height: 30,
                  px: 1.1,
                  color: "#b9d9ea",
                  border: `1px solid ${marketColors.line}`,
                  borderRadius: "8px",
                  fontSize: "0.56rem",
                  fontWeight: 800,
                  textTransform: "none",
                  "&:hover": { borderColor: "rgba(69,217,255,0.65)", bgcolor: "rgba(69,217,255,0.08)" },
                  "& svg": { fontSize: "15px !important" },
                }}
              >
                Import
              </Button>
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

          {activeNavigation === "Overview" ? (
            <MarketDashboardContent
              tickers={liveTickers}
              regions={synchronizedRegions}
              watchlist={synchronizedWatchlist}
              assetOptions={assetOptions}
              selectedSymbol={selectedSymbol}
              currentValue={feed.currentValue}
              change={quoteChange}
              changePercent={feed.changePercent}
              alertThreshold={alertThreshold}
              alerts={visibleAlerts}
              candles={viewCandles}
              zones={viewZones}
              heatmap={synchronizedHeatmap}
              timeframe={feed.timeframe}
              timeframes={availableTimeframes}
              marketStatus={selectedAsset.dataSource === "historical_import" || feed.source === "upload" ? "historical" : "live"}
              onAssetChange={chooseAsset}
              onAlertThresholdChange={setAlertThreshold}
              onTimeframeChange={setSelectedTimeframe}
              onCreateAlert={() => setAlertDialogOpen(true)}
              dataQuality={dataQuality}
              latencyMs={feed.latencyMs}
              lastUpdated={lastUpdatedLabel}
            />
          ) : (
            <Stack spacing={2}>
              <MarketControlBar
                assets={assetOptions}
                selectedSymbol={selectedSymbol}
                alertThreshold={alertThreshold}
                onAssetChange={chooseAsset}
                onAlertThresholdChange={setAlertThreshold}
                dataQuality={dataQuality}
                latencyMs={feed.latencyMs}
                lastUpdated={lastUpdatedLabel}
              />
              <MarketWorkspaceView
                view={activeNavigation as MarketWorkspaceViewName}
                candles={viewCandles}
                zones={viewZones}
                heatmap={synchronizedHeatmap}
                analytics={analytics.summary.bars ? analytics.summary : null}
                analyticsPoints={analytics.performance}
                regions={synchronizedRegions}
                tickers={liveTickers}
                alerts={allAlerts}
                watchlist={synchronizedWatchlist}
                assetOptions={assetOptions}
                selectedSymbol={selectedSymbol}
                selectedAssetName={selectedAsset.name}
                timeframe={feed.timeframe}
                availableTimeframes={availableTimeframes}
                currentValue={feed.currentValue}
                change={quoteChange}
                changePercent={feed.changePercent}
                alertThreshold={alertThreshold}
                dataQuality={dataQuality}
                latencyMs={feed.latencyMs}
                lastUpdated={lastUpdatedLabel}
                marketStatus={selectedAsset.dataSource === "historical_import" || feed.source === "upload" ? "historical" : "live"}
                onAssetChange={chooseAsset}
                onTimeframeChange={setSelectedTimeframe}
                onAlertThresholdChange={setAlertThreshold}
                onCreateAlert={() => setAlertDialogOpen(true)}
                onOpenAlert={() => setAlertDialogOpen(true)}
                onWatchlistAssetSelect={(asset) => chooseAsset(asset.symbol)}
              />
            </Stack>
          )}
          <MethodologyFooter
            isImported={selectedAsset.dataSource === "historical_import" || feed.source === "upload"}
            timeframe={feed.timeframe}
            barCount={viewCandles.length}
          />
        </Box>
      </Box>

      <Dialog
        open={uploadDialogOpen}
        onClose={() => !isUploading && setUploadDialogOpen(false)}
        fullWidth
        maxWidth="sm"
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
        <DialogTitle sx={{ fontSize: "1rem", fontWeight: 850 }}>Import historical OHLCV</DialogTitle>
        <DialogContent>
          <Typography sx={{ mb: 2, color: marketColors.muted, fontSize: "0.68rem", lineHeight: 1.6 }}>
            Upload UTF-8 CSV or JSON for any financial symbol. Required fields: timestamp, open, high, low, close. Volume is optional; duplicate timestamps use the last row.
          </Typography>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
              <TextField
                fullWidth
                size="small"
                label="Symbol"
                placeholder="AAPL, BTC-USD, EUR/USD"
                value={uploadSymbol}
                onChange={(event) => setUploadSymbol(event.target.value.toUpperCase())}
                inputProps={{ maxLength: 32, autoCapitalize: "characters" }}
              />
              <FormControl fullWidth size="small">
                <InputLabel id="import-timeframe-label">Timeframe</InputLabel>
                <Select
                  labelId="import-timeframe-label"
                  value={uploadTimeframe}
                  label="Timeframe"
                  onChange={(event) => setUploadTimeframe(event.target.value as ChartTimeframe)}
                >
                  <MenuItem value="15m">15 minutes</MenuItem>
                  <MenuItem value="30m">30 minutes</MenuItem>
                  <MenuItem value="1h">1 hour</MenuItem>
                  <MenuItem value="4h">4 hours</MenuItem>
                  <MenuItem value="1d">1 day</MenuItem>
                </Select>
              </FormControl>
            </Stack>
            <TextField
              fullWidth
              size="small"
              label="Display name (optional)"
              placeholder="Apple Inc."
              value={uploadName}
              onChange={(event) => setUploadName(event.target.value)}
              inputProps={{ maxLength: 120 }}
            />
            <Box>
              <Button
                component="label"
                startIcon={<FileUploadRounded />}
                sx={{ color: "#b9d9ea", border: `1px dashed ${marketColors.line}`, textTransform: "none" }}
              >
                Choose CSV or JSON file
                <input
                  hidden
                  type="file"
                  accept=".csv,.json,text/csv,application/json"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                />
              </Button>
              <Typography sx={{ mt: 0.8, color: uploadFile ? marketColors.demand : marketColors.muted, fontSize: "0.62rem" }}>
                {uploadFile ? `${uploadFile.name} · ${(uploadFile.size / 1024).toFixed(1)} KB` : "Maximum 10 MB / 10,000 rows"}
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button disabled={isUploading} onClick={() => setUploadDialogOpen(false)} sx={{ color: marketColors.muted }}>Cancel</Button>
          <Button
            disabled={isUploading}
            onClick={importHistoricalData}
            variant="contained"
            sx={{ color: "#03131e", bgcolor: marketColors.cyan, fontWeight: 850 }}
          >
            {isUploading ? "Importing…" : "Import data"}
          </Button>
        </DialogActions>
      </Dialog>

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
            Arm a {selectedSymbol} rule on the active {feed.timeframe.toUpperCase()} timeframe at the ±{alertThreshold.toFixed(1)}% threshold.
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

      <Dialog
        open={helpDialogOpen}
        onClose={() => setHelpDialogOpen(false)}
        fullWidth
        maxWidth="sm"
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
        <DialogTitle sx={{ fontSize: "1rem", fontWeight: 850 }}>Meridian data guide</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {[
              ["Importing OHLCV", "Choose CSV or JSON with timestamp, open, high, low, and close. Volume is optional. Dates, Unix seconds, and Unix milliseconds are supported."],
              ["Synchronized views", "Every analytical view uses the selected symbol, timeframe, candles, detected zones, and derived volume/return statistics from the same dataset."],
              ["Zone quality", "Scores combine departure strength, freshness, trend alignment, break of structure, and fair-value-gap evidence without future candles."],
              ["Alerts", "Approach, inside-zone, and boundary-crossing rules use the selected symbol and active timeframe."],
            ].map(([title, body]) => (
              <Box key={title} sx={{ p: 1.5, bgcolor: "rgba(255,255,255,0.025)", border: `1px solid ${marketColors.line}`, borderRadius: "12px" }}>
                <Typography sx={{ fontSize: "0.72rem", fontWeight: 850 }}>{title}</Typography>
                <Typography sx={{ mt: 0.55, color: marketColors.muted, fontSize: "0.64rem", lineHeight: 1.65 }}>{body}</Typography>
              </Box>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2.5 }}>
          <Button onClick={() => setHelpDialogOpen(false)} sx={{ color: marketColors.cyan }}>Done</Button>
        </DialogActions>
      </Dialog>

      <Drawer
        anchor="right"
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        slotProps={{
          paper: {
            sx: {
              width: "min(90vw, 380px)",
              p: 2,
              color: marketColors.text,
              bgcolor: "#071321",
              backgroundImage: "none",
              borderLeft: `1px solid ${marketColors.line}`,
            },
          },
        }}
      >
        <Typography sx={{ fontSize: "1rem", fontWeight: 850 }}>Workspace settings</Typography>
        <Typography sx={{ mt: 0.4, color: marketColors.muted, fontSize: "0.62rem" }}>
          Current data provenance and analysis defaults
        </Typography>
        <Stack spacing={1.2} sx={{ mt: 2 }}>
          {[
            ["Selected market", `${selectedSymbol} · ${selectedAsset.name}`],
            ["Source", selectedAsset.dataSource === "historical_import" ? "Historical upload" : selectedAsset.dataSource === "alpha_vantage" ? "Alpha Vantage" : "Deterministic simulator"],
            ["Timeframe", feed.timeframe.toUpperCase()],
            ["Loaded bars", viewCandles.length.toLocaleString()],
            ["Detected zones", viewZones.length.toLocaleString()],
            ["API", marketEndpoints.apiBaseUrl ? "Configured" : "Optional API not configured"],
          ].map(([label, value]) => (
            <Stack key={label} direction="row" justifyContent="space-between" spacing={2} sx={{ p: 1.25, bgcolor: "rgba(255,255,255,0.025)", border: `1px solid ${marketColors.line}`, borderRadius: "10px" }}>
              <Typography sx={{ color: marketColors.muted, fontSize: "0.61rem" }}>{label}</Typography>
              <Typography sx={{ maxWidth: 205, textAlign: "right", fontSize: "0.61rem", fontWeight: 800 }}>{value}</Typography>
            </Stack>
          ))}
        </Stack>
        <Stack spacing={1} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            startIcon={<FileUploadRounded />}
            onClick={() => { setSettingsOpen(false); setUploadDialogOpen(true); }}
            sx={{ color: "#03131e", bgcolor: marketColors.cyan, fontWeight: 850, textTransform: "none" }}
          >
            Import dataset
          </Button>
          <Button
            startIcon={<AddAlertRounded />}
            onClick={() => { setSettingsOpen(false); setAlertDialogOpen(true); }}
            sx={{ color: marketColors.cyan, border: `1px solid ${marketColors.line}`, textTransform: "none" }}
          >
            Configure alert
          </Button>
        </Stack>
      </Drawer>

      <Snackbar open={Boolean(notice)} autoHideDuration={4200} onClose={() => setNotice(null)}>
        <MuiAlert severity={notice?.severity ?? "success"} variant="filled" onClose={() => setNotice(null)}>
          {notice?.message}
        </MuiAlert>
      </Snackbar>
    </Box>
  );
}

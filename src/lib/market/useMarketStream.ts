"use client";

import { useEffect, useState } from "react";
import {
  adaptCandleResponse,
  adaptMarketSnapshot,
  adaptZoneResponse,
  buildMarketRestUrls,
  filterMarketZones,
  marketBucketAdvanced,
  marketReconnectDelayMs,
  mergeMarketQuoteIntoCandles,
  mergeMarketAlerts,
  normalizeMarketSymbol,
  normalizeMarketTimeframe,
  resolveMarketEndpoints,
  selectMarketSnapshot,
  type MarketEndpointInput,
  type MarketFeedSource,
  type MarketStreamAlert,
  type MarketStreamCandle,
  type MarketStreamPressure,
  type MarketStreamZone,
  type MarketTimeframeInput,
} from "./market-stream-adapter";
import type { MarketTimeframe } from "./types";

export type MarketFeedStatus = "connecting" | "connected" | "unavailable";

export interface UseMarketStreamOptions {
  symbol: string;
  timeframe: MarketTimeframeInput;
  fallbackValue?: number;
  fallbackChangePercent?: number;
  /** Host or full `/api/v1` prefix. Undefined reads public env; null disables REST. */
  apiBaseUrl?: string | null;
  /** Host or full `/ws/market` URL. Undefined reads public env; null disables WS. */
  wsUrl?: string | null;
  candleLimit?: number;
  includeTestedZones?: boolean;
  minZoneQuality?: number;
  simulationIntervalMs?: number;
  /** REST polling cadence when WebSocket transport is disabled. */
  restRefreshIntervalMs?: number;
  /** Prefer REST candle close/change over overlapping snapshot symbols. */
  preferRestCandles?: boolean;
  onTimeframeResolved?: (timeframe: MarketTimeframe) => void;
}

export interface MarketFeedState {
  symbol: string;
  timeframe: MarketTimeframe;
  currentValue: number;
  changePercent: number;
  status: MarketFeedStatus;
  source: MarketFeedSource;
  latencyMs: number;
  sequence: number;
  updatedAt: Date | null;
  isLoading: boolean;
  error: string | null;
  candles: readonly MarketStreamCandle[];
  zones: readonly MarketStreamZone[];
  pressure: readonly MarketStreamPressure[];
  alerts: readonly MarketStreamAlert[];
}

interface ResolvedHookOptions {
  symbol: string;
  timeframe: MarketTimeframe;
  fallbackValue: number;
  fallbackChangePercent: number;
  apiBaseUrl?: string;
  wsUrl?: string;
  candleLimit: number;
  includeTestedZones: boolean;
  minZoneQuality: number;
  simulationIntervalMs: number;
  restRefreshIntervalMs: number;
  preferRestCandles: boolean;
  onTimeframeResolved?: (timeframe: MarketTimeframe) => void;
}

function publicEnvironmentEndpoints(options: UseMarketStreamOptions): MarketEndpointInput {
  const environmentApi =
    process.env.NEXT_PUBLIC_MARKET_API_URL ?? process.env.NEXT_PUBLIC_GMI_API_URL;
  const environmentWs =
    process.env.NEXT_PUBLIC_MARKET_WS_URL ?? process.env.NEXT_PUBLIC_GMI_WS_URL;
  return {
    apiUrl: options.apiBaseUrl === undefined ? environmentApi : options.apiBaseUrl,
    // An empty public WS URL explicitly selects REST-only mode. Vercel's
    // Python functions do not provide a persistent WebSocket server.
    wsUrl:
      options.wsUrl === undefined
        ? environmentWs?.trim()
          ? environmentWs
          : null
        : options.wsUrl,
  };
}

function resolveHookOptions(
  optionsOrSymbol: UseMarketStreamOptions | string,
  legacyFallbackValue?: number,
  legacyFallbackChangePercent?: number,
  legacyTimeframe: MarketTimeframeInput = "15m",
): ResolvedHookOptions {
  const options: UseMarketStreamOptions =
    typeof optionsOrSymbol === "string"
      ? {
          symbol: optionsOrSymbol,
          timeframe: legacyTimeframe,
          fallbackValue: legacyFallbackValue,
          fallbackChangePercent: legacyFallbackChangePercent,
        }
      : optionsOrSymbol;
  const endpoints = resolveMarketEndpoints(publicEnvironmentEndpoints(options));
  const fallbackValue = options.fallbackValue ?? 0;
  if (!Number.isFinite(fallbackValue) || fallbackValue < 0) {
    throw new RangeError("fallbackValue must be a finite number greater than or equal to zero.");
  }
  const fallbackChangePercent = options.fallbackChangePercent ?? 0;
  if (!Number.isFinite(fallbackChangePercent)) {
    throw new RangeError("fallbackChangePercent must be finite.");
  }
  return {
    symbol: normalizeMarketSymbol(options.symbol),
    timeframe: normalizeMarketTimeframe(options.timeframe),
    fallbackValue,
    fallbackChangePercent,
    apiBaseUrl: endpoints.apiBaseUrl,
    wsUrl: endpoints.wsUrl,
    candleLimit: Math.min(500, Math.max(1, Math.round(options.candleLimit ?? 120))),
    includeTestedZones: options.includeTestedZones ?? true,
    minZoneQuality: Math.min(100, Math.max(0, options.minZoneQuality ?? 0)),
    simulationIntervalMs: Math.max(500, Math.round(options.simulationIntervalMs ?? 1_600)),
    restRefreshIntervalMs: Math.max(15_000, Math.round(options.restRefreshIntervalMs ?? 60_000)),
    preferRestCandles: options.preferRestCandles ?? false,
    onTimeframeResolved: options.onTimeframeResolved,
  };
}

function mergeLiveCandle(
  candles: readonly MarketStreamCandle[],
  incoming: MarketStreamCandle | undefined,
  limit: number,
): readonly MarketStreamCandle[] {
  if (!incoming) return candles;
  const existingIndex = candles.findIndex((candle) => candle.time === incoming.time);
  if (existingIndex >= 0) {
    const next = [...candles];
    next[existingIndex] = incoming;
    return next;
  }
  if (candles.length > 0 && incoming.time < candles[candles.length - 1].time) return candles;
  return [...candles, incoming].slice(-limit);
}

function alertsForSelection(
  alerts: readonly MarketStreamAlert[],
  zones: readonly MarketStreamZone[],
  timeframe: MarketTimeframe,
): readonly MarketStreamAlert[] {
  const selectedZoneIds = new Set(zones.map((zone) => zone.id));
  return alerts.filter((alert) =>
    alert.timeframe ? alert.timeframe === timeframe : selectedZoneIds.has(alert.zoneId),
  );
}

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    signal,
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`.trim());
  return response.json() as Promise<unknown>;
}

export function useMarketStream(options: UseMarketStreamOptions): MarketFeedState;
/** @deprecated Prefer the typed options object overload so timeframe is explicit. */
export function useMarketStream(
  symbol: string,
  fallbackValue: number,
  fallbackChangePercent: number,
  timeframe?: MarketTimeframeInput,
): MarketFeedState;
export function useMarketStream(
  optionsOrSymbol: UseMarketStreamOptions | string,
  legacyFallbackValue?: number,
  legacyFallbackChangePercent?: number,
  legacyTimeframe: MarketTimeframeInput = "15m",
): MarketFeedState {
  const options = resolveHookOptions(
    optionsOrSymbol,
    legacyFallbackValue,
    legacyFallbackChangePercent,
    legacyTimeframe,
  );
  const {
    symbol,
    timeframe,
    fallbackValue,
    fallbackChangePercent,
    apiBaseUrl,
    wsUrl,
    candleLimit,
    includeTestedZones,
    minZoneQuality,
    restRefreshIntervalMs,
    preferRestCandles,
    onTimeframeResolved,
  } = options;
  const [state, setState] = useState<MarketFeedState>(() => ({
    symbol,
    timeframe,
    currentValue: fallbackValue,
    changePercent: fallbackChangePercent,
    status: wsUrl || apiBaseUrl ? "connecting" : "unavailable",
    source: "unavailable",
    latencyMs: 0,
    sequence: 0,
    updatedAt: null,
    isLoading: Boolean(apiBaseUrl),
    error: null,
    candles: [],
    zones: [],
    pressure: [],
    alerts: [],
  }));

  useEffect(() => {
    let restRefreshTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    const controller = new AbortController();
    let disposed = false;
    let reconnectAttempt = 0;
    let lastWireSequence = 0;
    let latestRestRequest = 0;
    let latestAppliedRestRequest = 0;
    let lastObservedTickAt: number | undefined;

    queueMicrotask(() => {
      if (disposed) return;
      setState({
        symbol,
        timeframe,
        currentValue: fallbackValue,
        changePercent: fallbackChangePercent,
        status: wsUrl || apiBaseUrl ? "connecting" : "unavailable",
        source: "unavailable",
        latencyMs: 0,
        sequence: 0,
        updatedAt: new Date(),
        isLoading: Boolean(apiBaseUrl),
        error: null,
        candles: [],
        zones: [],
        pressure: [],
        alerts: [],
      });
    });

    function observeTickBucket(tickAt: number) {
      const advanced = marketBucketAdvanced(lastObservedTickAt, tickAt, timeframe);
      if (lastObservedTickAt === undefined || tickAt > lastObservedTickAt) {
        lastObservedTickAt = tickAt;
      }
      if (advanced && apiBaseUrl) void loadRest(tickAt);
    }


    async function loadRest(observedAt?: number): Promise<boolean> {
      if (!apiBaseUrl) return false;
      const requestId = ++latestRestRequest;
      const urls = buildMarketRestUrls(apiBaseUrl, symbol, timeframe, {
        candleLimit,
        includeTestedZones,
        minZoneQuality,
      });
      const requestedAt = Date.now();
      const [candleResult, zoneResult, snapshotResult] = await Promise.allSettled([
        fetchJson(urls.candles, controller.signal),
        fetchJson(urls.zones, controller.signal),
        fetchJson(urls.snapshot, controller.signal),
      ]);
      if (disposed || requestId < latestAppliedRestRequest) return false;

      const candles =
        candleResult.status === "fulfilled"
          ? adaptCandleResponse(candleResult.value, symbol, timeframe)
          : undefined;
      const restZones =
        zoneResult.status === "fulfilled"
          ? filterMarketZones(adaptZoneResponse(zoneResult.value, symbol, timeframe), {
              includeTestedZones,
              minZoneQuality,
            })
          : undefined;
      const snapshot =
        snapshotResult.status === "fulfilled"
          ? adaptMarketSnapshot(snapshotResult.value)
          : undefined;
      const selected = snapshot ? selectMarketSnapshot(snapshot, symbol, timeframe) : undefined;
      const snapshotZones =
        selected?.zonesAreAuthoritative
          ? filterMarketZones(selected.zones, {
              includeTestedZones,
              minZoneQuality,
            })
          : undefined;
      const zones = restZones ?? snapshotZones;
      const successes = [candles !== undefined, zones !== undefined, snapshot !== undefined].filter(Boolean).length;
      const failures = [candleResult, zoneResult, snapshotResult]
        .filter((result) => result.status === "rejected")
        .map((result) => (result as PromiseRejectedResult).reason)
        .map((reason) => (reason instanceof Error ? reason.message : String(reason)));

      if (successes === 0) {
        if (!controller.signal.aborted) {
          setState((current) => ({
            ...current,
            status: "unavailable",
            source: "unavailable",
            isLoading: false,
            error: failures.join("; ") || "Market API returned no usable data.",
            candles: [],
            zones: [],
            pressure: [],
            alerts: [],
          }));
        }
        return false;
      }
      latestAppliedRestRequest = requestId;
      const snapshotTime = snapshot?.generatedAt ?? observedAt;
      if (
        snapshotTime !== undefined &&
        snapshotTime !== null &&
        (lastObservedTickAt === undefined || snapshotTime > lastObservedTickAt)
      ) {
        lastObservedTickAt = snapshotTime;
      }
      const receivedAt = Date.now();
      const restCurrentValue = candles?.at(-1)?.close;
      const restPreviousValue = candles && candles.length > 1 ? candles[candles.length - 2].close : undefined;
      const restChangePercent =
        restCurrentValue !== undefined && restPreviousValue !== undefined && restPreviousValue > 0
          ? ((restCurrentValue / restPreviousValue) - 1) * 100
          : undefined;
      const effectiveTimeframe = candles?.at(-1)?.timeframe;
      if (effectiveTimeframe && effectiveTimeframe !== timeframe) {
        onTimeframeResolved?.(effectiveTimeframe);
      }
      setState((current) => {
        const nextZones = zones ?? current.zones;
        const snapshotIsFresh = !snapshot || snapshot.sequence >= lastWireSequence;
        const selectedValue = preferRestCandles
          ? restCurrentValue
          : snapshotIsFresh
            ? selected?.currentValue ?? restCurrentValue
            : restCurrentValue;
        const selectedChange = preferRestCandles
          ? restChangePercent
          : snapshotIsFresh
            ? selected?.changePercent ?? restChangePercent
            : restChangePercent;
        let nextCandles: readonly MarketStreamCandle[] = candles ?? current.candles;
        if (!preferRestCandles && snapshotIsFresh && selected?.liveCandle) {
          nextCandles = mergeLiveCandle(nextCandles, selected.liveCandle, candleLimit);
        } else if (!preferRestCandles) {
          const quotePrice = selectedValue ?? current.currentValue;
          const quoteTime = snapshotTime ?? lastObservedTickAt;
          if (quoteTime !== undefined) {
            nextCandles = mergeMarketQuoteIntoCandles(
              nextCandles,
              { symbol, timeframe, price: quotePrice, generatedAt: quoteTime },
              candleLimit,
            );
          }
        }
        const restAlerts = selected
          ? alertsForSelection(selected.alerts, nextZones, timeframe)
          : [];
        return {
          ...current,
          timeframe: effectiveTimeframe ?? current.timeframe,
          currentValue: selectedValue ?? current.currentValue,
          changePercent: selectedChange ?? current.changePercent,
          status: current.status === "connected" || !wsUrl ? "connected" : "connecting",
          source: current.source === "websocket" ? "websocket" : "rest",
          latencyMs: snapshot?.generatedAt
            ? Math.max(0, receivedAt - snapshot.generatedAt)
            : receivedAt - requestedAt,
          sequence: Math.max(current.sequence, snapshot?.sequence ?? 0),
          updatedAt: new Date(receivedAt),
          isLoading: false,
          error: failures.length > 0 ? `Partial REST fallback: ${failures.join("; ")}` : null,
          candles: nextCandles,
          zones: nextZones,
          pressure:
            selected && selected.pressure.length > 0 ? selected.pressure : current.pressure,
          alerts: mergeMarketAlerts(current.alerts, restAlerts, 20),
        };
      });
      return true;
    }

    void loadRest();

    function scheduleReconnect(reason: string) {
      if (!wsUrl || disposed || reconnectTimer) return;
      setState((current) => ({
        ...current,
        status: "connecting",
        source: "unavailable",
        isLoading: true,
        error: reason,
      }));
      const delay = marketReconnectDelayMs(reconnectAttempt);
      reconnectAttempt = Math.min(reconnectAttempt + 1, 30);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        connectWebSocket();
      }, delay);
    }

    function connectWebSocket() {
      if (!wsUrl || disposed) return;
      try {
        const candidate = new WebSocket(wsUrl);
        socket = candidate;
        candidate.addEventListener("open", () => {
          if (!disposed) {
            lastWireSequence = 0;
            setState((current) => ({
              ...current,
              status: "connected",
              source: "websocket",
              error: null,
            }));
          }
        });
        candidate.addEventListener("message", (event) => {
          if (disposed) return;
          const receivedAt = Date.now();
          try {
            const snapshot = adaptMarketSnapshot(JSON.parse(String(event.data)) as unknown);
            if (!snapshot) return;
            if (snapshot.sequence > 0 && snapshot.sequence < lastWireSequence) return;
            lastWireSequence = snapshot.sequence;
            reconnectAttempt = 0;
            const selected = selectMarketSnapshot(snapshot, symbol, timeframe);
            if (snapshot.generatedAt !== null) observeTickBucket(snapshot.generatedAt);
            setState((current) => {
              const filteredZones = filterMarketZones(selected.zones, {
                includeTestedZones,
                minZoneQuality,
              });
              const nextZones =
                selected.zonesAreAuthoritative
                  ? filteredZones
                  : current.zones;
              const incomingAlerts = alertsForSelection(
                selected.alerts,
                nextZones,
                timeframe,
              );
              const nextCandles = selected.liveCandle
                ? mergeLiveCandle(current.candles, selected.liveCandle, candleLimit)
                : selected.currentValue !== undefined && snapshot.generatedAt !== null
                  ? mergeMarketQuoteIntoCandles(
                      current.candles,
                      {
                        symbol,
                        timeframe,
                        price: selected.currentValue,
                        generatedAt: snapshot.generatedAt,
                      },
                      candleLimit,
                    )
                  : current.candles;
              return {
                ...current,
                currentValue: selected.currentValue ?? current.currentValue,
                changePercent: selected.changePercent ?? current.changePercent,
                status: "connected",
                source: "websocket",
                latencyMs: snapshot.generatedAt
                  ? Math.max(0, receivedAt - snapshot.generatedAt)
                  : current.latencyMs,
                sequence: snapshot.sequence,
                updatedAt: new Date(receivedAt),
                isLoading: false,
                error: null,
                candles: nextCandles,
                zones: nextZones,
                pressure:
                  selected.pressure.length > 0 ? selected.pressure : current.pressure,
                alerts: mergeMarketAlerts(current.alerts, incomingAlerts, 20),
              };
            });
          } catch {
            // A later full snapshot repairs malformed or partially written frames.
          }
        });
        candidate.addEventListener("close", () => {
          if (socket === candidate) socket = undefined;
          scheduleReconnect("WebSocket disconnected; retrying live API.");
        });
        candidate.addEventListener("error", () => candidate.close());
      } catch {
        scheduleReconnect("WebSocket unavailable; retrying live API.");
      }
    }

    if (wsUrl) connectWebSocket();
    else if (apiBaseUrl) {
      restRefreshTimer = setInterval(() => void loadRest(), restRefreshIntervalMs);
    }

    return () => {
      disposed = true;
      controller.abort();
      if (restRefreshTimer) clearInterval(restRefreshTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [
    apiBaseUrl,
    candleLimit,
    fallbackChangePercent,
    fallbackValue,
    includeTestedZones,
    minZoneQuality,
    onTimeframeResolved,
    preferRestCandles,
    restRefreshIntervalMs,
    symbol,
    timeframe,
    wsUrl,
  ]);

  return state;
}

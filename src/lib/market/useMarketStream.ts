"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateSupplyDemandScore } from "./scoring";
import { DEMO_FOCUS_BARS, DEMO_PRESSURE_MARKETS } from "./demo-data";
import { resampleOhlcv } from "./timeframes";
import { detectSupplyDemandZones } from "./zones";
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

export type MarketFeedStatus = "connecting" | "connected" | "simulated";

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
}

interface DemoBundle {
  candles: readonly MarketStreamCandle[];
  zones: readonly MarketStreamZone[];
  pressure: readonly MarketStreamPressure[];
  alerts: readonly MarketStreamAlert[];
}

function precisionFor(value: number): number {
  if (value < 10) return 4;
  return 2;
}

function publicEnvironmentEndpoints(options: UseMarketStreamOptions): MarketEndpointInput {
  const environmentApi =
    process.env.NEXT_PUBLIC_MARKET_API_URL ?? process.env.NEXT_PUBLIC_GMI_API_URL;
  const environmentWs =
    process.env.NEXT_PUBLIC_MARKET_WS_URL ?? process.env.NEXT_PUBLIC_GMI_WS_URL;
  return {
    apiUrl: options.apiBaseUrl === undefined ? environmentApi : options.apiBaseUrl,
    wsUrl: options.wsUrl === undefined ? environmentWs : options.wsUrl,
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
  const fallbackValue = options.fallbackValue ?? 1_000;
  if (!Number.isFinite(fallbackValue) || fallbackValue <= 0) {
    throw new RangeError("fallbackValue must be a finite number greater than zero.");
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
  };
}

function createDemoBundle(
  symbol: string,
  timeframe: MarketTimeframe,
  fallbackValue: number,
  includeTestedZones: boolean,
  minZoneQuality: number,
): DemoBundle {
  const lastDemoClose = DEMO_FOCUS_BARS[DEMO_FOCUS_BARS.length - 1]?.close ?? 1_000;
  const scale = fallbackValue / lastDemoClose;
  const scaled = DEMO_FOCUS_BARS.map((bar) => ({
    ...bar,
    open: bar.open * scale,
    high: bar.high * scale,
    low: bar.low * scale,
    close: bar.close * scale,
  }));
  const resampled = resampleOhlcv(scaled, timeframe);
  const candles: MarketStreamCandle[] = resampled.map((bar) => ({
    ...bar,
    symbol,
    timeframe,
  }));
  const detectedZones: MarketStreamZone[] = detectSupplyDemandZones(candles, {
    timeframe,
    minRangeAtrMultiple: 1.15,
  })
    .filter((zone) => zone.quality.freshness !== "invalidated")
    .map((zone) => ({
      id: zone.id,
      symbol,
      timeframe,
      side: zone.side,
      lower: zone.lower,
      upper: zone.upper,
      proximal: zone.proximal,
      distal: zone.distal,
      baseTimestamp: zone.createdAt,
      impulseStart: candles[zone.impulseStartIndex]?.time ?? zone.createdAt,
      impulseEnd: candles[zone.impulseEndIndex]?.time ?? zone.createdAt,
      impulseCandles: zone.impulseEndIndex - zone.impulseStartIndex + 1,
      qualityScore: zone.quality.score,
      freshness: zone.quality.freshness as "virgin" | "tested",
      testCount: zone.quality.testCount,
      trendAligned: zone.quality.trendAligned,
      fairValueGap: zone.quality.fairValueGap,
      breakOfStructure: zone.quality.breakOfStructure,
      rationale: zone.structuralDescription,
    }));
  const zones = filterMarketZones(detectedZones, {
    includeTestedZones,
    minZoneQuality,
  });
  const pressure: MarketStreamPressure[] = DEMO_PRESSURE_MARKETS.map((market) => {
    const score = calculateSupplyDemandScore(market.inputs);
    return {
      key: market.id,
      label: market.label,
      group: market.group,
      score: score.netPressure,
      state:
        score.netPressure >= 20
          ? "demand"
          : score.netPressure <= -20
            ? "supply"
            : "balanced",
      confidence: Math.min(1, 0.55 + Math.abs(score.netPressure) / 250),
      drivers: Object.fromEntries(Object.entries(score.contributions)) as Record<string, number>,
    };
  });
  return { candles, zones, pressure, alerts: [] };
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
    simulationIntervalMs,
  } = options;
  const demo = useMemo(
    () =>
      createDemoBundle(
        symbol,
        timeframe,
        fallbackValue,
        includeTestedZones,
        minZoneQuality,
      ),
    [fallbackValue, includeTestedZones, minZoneQuality, symbol, timeframe],
  );
  const [state, setState] = useState<MarketFeedState>(() => ({
    symbol,
    timeframe,
    currentValue: fallbackValue,
    changePercent: fallbackChangePercent,
    status: wsUrl || apiBaseUrl ? "connecting" : "simulated",
    source: "demo",
    latencyMs: 84,
    sequence: 0,
    updatedAt: null,
    isLoading: Boolean(apiBaseUrl),
    error: null,
    ...demo,
  }));

  useEffect(() => {
    let simulationTimer: ReturnType<typeof setInterval> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    const controller = new AbortController();
    let disposed = false;
    let simulationSequence = 0;
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
        status: wsUrl || apiBaseUrl ? "connecting" : "simulated",
        source: "demo",
        latencyMs: 84,
        sequence: 0,
        updatedAt: new Date(),
        isLoading: Boolean(apiBaseUrl),
        error: null,
        ...demo,
      });
    });

    function stopSimulation() {
      if (simulationTimer) clearInterval(simulationTimer);
      simulationTimer = undefined;
    }

    function observeTickBucket(tickAt: number) {
      const advanced = marketBucketAdvanced(lastObservedTickAt, tickAt, timeframe);
      if (lastObservedTickAt === undefined || tickAt > lastObservedTickAt) {
        lastObservedTickAt = tickAt;
      }
      if (advanced && apiBaseUrl) void loadRest(tickAt);
    }

    function startSimulation(reason?: string) {
      if (simulationTimer || disposed) return;
      setState((current) => ({
        ...current,
        status: "simulated",
        source: "demo",
        isLoading: false,
        error: reason ?? current.error,
      }));
      simulationTimer = setInterval(() => {
        simulationSequence += 1;
        const tickAt = Date.now();
        const wave = Math.sin(simulationSequence * 0.83 + symbol.length) * 0.00012;
        const microMove = wave + Math.cos(simulationSequence * 0.31) * 0.000045;
        setState((current) => {
          const nextValue = Number(
            (current.currentValue * (1 + microMove)).toFixed(
              precisionFor(current.currentValue),
            ),
          );
          return {
            ...current,
            currentValue: nextValue,
            changePercent: Number((current.changePercent + microMove * 100).toFixed(3)),
            status: "simulated",
            source: "demo",
            sequence: current.sequence + 1,
            updatedAt: new Date(tickAt),
            candles: mergeMarketQuoteIntoCandles(
              current.candles,
              { symbol, timeframe, price: nextValue, generatedAt: tickAt },
              candleLimit,
            ),
          };
        });
        observeTickBucket(tickAt);
      }, simulationIntervalMs);
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
        if (!controller.signal.aborted && !wsUrl) {
          startSimulation("REST market feed unavailable; using demo data.");
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
      setState((current) => {
        const nextZones = zones ?? current.zones;
        const snapshotIsFresh = !snapshot || snapshot.sequence >= lastWireSequence;
        const selectedValue = snapshotIsFresh ? selected?.currentValue : undefined;
        const selectedChange = snapshotIsFresh ? selected?.changePercent : undefined;
        let nextCandles: readonly MarketStreamCandle[] = candles ?? current.candles;
        if (snapshotIsFresh && selected?.liveCandle) {
          nextCandles = mergeLiveCandle(nextCandles, selected.liveCandle, candleLimit);
        } else {
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
      startSimulation(reason);
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
            stopSimulation();
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
          scheduleReconnect("WebSocket disconnected; using deterministic fallback ticks.");
        });
        candidate.addEventListener("error", () => candidate.close());
      } catch {
        scheduleReconnect("WebSocket unavailable; using deterministic fallback ticks.");
      }
    }

    if (wsUrl) connectWebSocket();
    else if (!apiBaseUrl) startSimulation();

    return () => {
      disposed = true;
      controller.abort();
      stopSimulation();
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [
    apiBaseUrl,
    candleLimit,
    demo,
    fallbackChangePercent,
    fallbackValue,
    includeTestedZones,
    minZoneQuality,
    simulationIntervalMs,
    symbol,
    timeframe,
    wsUrl,
  ]);

  return state;
}

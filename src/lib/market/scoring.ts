import type {
  PressureRegime,
  SupplyDemandInputs,
  SupplyDemandScore,
  SupplyDemandWeights,
} from "./types.js";

export const DEFAULT_SUPPLY_DEMAND_WEIGHTS: Readonly<SupplyDemandWeights> = {
  priceMomentum: 0.18,
  volumeImbalance: 0.17,
  orderBookImbalance: 0.22,
  physicalFlowBalance: 0.2,
  inventoryPressure: 0.13,
  logisticsPressure: 0.1,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, precision = 2): number {
  const multiplier = 10 ** precision;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function regimeForPressure(netPressure: number): PressureRegime {
  if (netPressure >= 50) return "strong-demand";
  if (netPressure >= 15) return "demand";
  if (netPressure > -15) return "balanced";
  if (netPressure > -50) return "supply";
  return "strong-supply";
}

function normalizeWeights(weights: SupplyDemandWeights): SupplyDemandWeights {
  const entries = Object.entries(weights) as [keyof SupplyDemandInputs, number][];
  if (entries.some(([, value]) => !Number.isFinite(value) || value < 0)) {
    throw new RangeError("Supply/demand weights must be finite and non-negative.");
  }
  const total = entries.reduce((sum, [, value]) => sum + value, 0);
  if (total <= 0) throw new RangeError("At least one supply/demand weight must be positive.");
  return Object.fromEntries(entries.map(([key, value]) => [key, value / total])) as unknown as SupplyDemandWeights;
}

/**
 * Combines normalized physical and financial indicators into a symmetric score.
 * Each input is clipped to [-1, 1]; positive values always mean demand/tightness.
 */
export function calculateSupplyDemandScore(
  inputs: SupplyDemandInputs,
  weights: SupplyDemandWeights = DEFAULT_SUPPLY_DEMAND_WEIGHTS,
): SupplyDemandScore {
  const normalizedWeights = normalizeWeights(weights);
  const contributions = {} as SupplyDemandInputs;
  let net = 0;

  (Object.keys(normalizedWeights) as (keyof SupplyDemandInputs)[]).forEach((key) => {
    const input = inputs[key];
    if (!Number.isFinite(input)) throw new TypeError(`${key} must be finite.`);
    const clipped = clamp(input, -1, 1);
    contributions[key] = round(clipped * normalizedWeights[key] * 100);
    net += clipped * normalizedWeights[key];
  });

  const netPressure = round(clamp(net, -1, 1) * 100);
  const demandScore = round(50 + netPressure / 2);
  return {
    netPressure,
    demandScore,
    supplyScore: round(100 - demandScore),
    regime: regimeForPressure(netPressure),
    contributions,
  };
}

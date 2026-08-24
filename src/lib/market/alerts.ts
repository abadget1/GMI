import type {
  SupplyDemandZone,
  ZoneAlertEvaluation,
  ZoneAlertInput,
  ZoneBoundary,
} from "./types.js";

function assertPrice(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite number greater than zero.`);
  }
}

function round(value: number, precision = 4): number {
  const multiplier = 10 ** precision;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function nearestBoundary(
  zone: SupplyDemandZone,
  price: number,
): { boundary: ZoneBoundary; price: number } {
  const proximalDistance = Math.abs(price - zone.proximal);
  const distalDistance = Math.abs(price - zone.distal);
  return proximalDistance <= distalDistance
    ? { boundary: "proximal", price: zone.proximal }
    : { boundary: "distal", price: zone.distal };
}

function crossedBoundary(
  zone: SupplyDemandZone,
  previousPrice: number,
  currentPrice: number,
): ZoneBoundary | undefined {
  if (zone.side === "demand") {
    if (previousPrice >= zone.lower && currentPrice < zone.lower) return "distal";
    if (previousPrice > zone.upper && currentPrice <= zone.upper) return "proximal";
    return undefined;
  }
  if (previousPrice <= zone.upper && currentPrice > zone.upper) return "distal";
  if (previousPrice < zone.lower && currentPrice >= zone.lower) return "proximal";
  return undefined;
}

/** Evaluates proximity and crossing transitions for one current quote and one zone. */
export function evaluateZoneAlert({
  zone,
  currentPrice,
  previousPrice,
  proximityPercent = 0.5,
}: ZoneAlertInput): ZoneAlertEvaluation {
  assertPrice(currentPrice, "currentPrice");
  if (previousPrice !== undefined) assertPrice(previousPrice, "previousPrice");
  if (!Number.isFinite(proximityPercent) || proximityPercent < 0) {
    throw new RangeError("proximityPercent must be a finite, non-negative number.");
  }

  const inside = currentPrice >= zone.lower && currentPrice <= zone.upper;
  const nearest = nearestBoundary(zone, currentPrice);
  const distancePoints = inside ? 0 : Math.abs(currentPrice - nearest.price);
  const distancePercent = (distancePoints / currentPrice) * 100;
  const transition =
    previousPrice === undefined ? undefined : crossedBoundary(zone, previousPrice, currentPrice);
  const breachedDistal =
    zone.side === "demand" ? currentPrice < zone.lower : currentPrice > zone.upper;

  let status: ZoneAlertEvaluation["status"] = "outside";
  if (transition || breachedDistal) status = "crossed";
  else if (inside) status = "within";
  else if (distancePercent <= proximityPercent) status = "approaching";

  const message =
    status === "crossed"
      ? `${zone.side} zone ${transition ?? "distal"} boundary crossed at ${round(currentPrice)}.`
      : status === "within"
        ? `Price is within the ${zone.side} zone.`
        : status === "approaching"
          ? `Price is ${round(distancePercent)}% from the ${zone.side} zone.`
          : `Price is outside the ${zone.side} alert threshold.`;

  return {
    zoneId: zone.id,
    side: zone.side,
    status,
    currentPrice,
    distancePoints: round(distancePoints),
    distancePercent: round(distancePercent),
    nearestBoundary: nearest.boundary,
    crossedBoundary: transition,
    message,
  };
}

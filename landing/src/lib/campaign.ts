import { CAMPAIGN_CONFIG } from "./campaign-config";

export type Exposure = "low" | "base" | "high";
type Config = typeof CAMPAIGN_CONFIG;

export interface CampaignInput {
  budget: number;
  days: number;
  vehicles: number;
  playsPerDay: number;
  adSeconds: number;
  exposure: Exposure;
}

export const clamp = (n: number, min: number, max: number) =>
  Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;

export function pricePerPlayback(adSeconds: number, cfg: Config = CAMPAIGN_CONFIG) {
  return cfg.pricePer30sPlayback * (adSeconds / 30);
}

/** Max plays one screen can deliver per day within the active window (no other ads/breaks). */
export function maxPlaysPerVehiclePerDay(adSeconds: number, cfg: Config = CAMPAIGN_CONFIG) {
  return Math.floor((cfg.screenActiveHoursPerDay * 3600) / adSeconds);
}

export function passengerOpportunities(vehicles: number, days: number, cfg: Config = CAMPAIGN_CONFIG) {
  return vehicles * cfg.ridesPerVehiclePerDay * cfg.passengersPerRide * days;
}

export function estimateBudgetCampaign(input: CampaignInput, cfg: Config = CAMPAIGN_CONFIG) {
  const price = pricePerPlayback(input.adSeconds, cfg);
  const slotCap = maxPlaysPerVehiclePerDay(input.adSeconds, cfg);
  const effectivePlays = Math.min(input.playsPerDay, slotCap);
  const affordable = Math.floor(input.budget / price);
  const requested = input.vehicles * input.playsPerDay * input.days;
  const capacity = input.vehicles * effectivePlays * input.days;
  const delivered = Math.min(affordable, capacity);
  const mediaCost = round2(delivered * price);
  const unspent = round2(Math.max(0, input.budget - mediaCost));
  const opportunities = passengerOpportunities(input.vehicles, input.days, cfg);
  const exposure = cfg.exposure[input.exposure];
  const impressions = Math.round(
    Math.min(opportunities * exposure, delivered * cfg.passengersPerRide),
  );
  const cpm = impressions > 0 ? round2((mediaCost / impressions) * 1000) : 0;
  const budgetLimited = affordable < capacity;
  const frequencyCapped = input.playsPerDay > slotCap;
  return {
    price,
    slotCap,
    affordable,
    requested,
    requestedCost: round2(requested * price),
    capacity,
    delivered,
    playsPerDay: Math.round(delivered / input.days),
    playsPerVehiclePerDay: input.vehicles ? delivered / input.days / input.vehicles : 0,
    mediaCost,
    unspent,
    opportunities,
    impressions,
    cpm,
    budgetLimited,
    frequencyCapped,
    feasibleVehicles: Math.floor(affordable / (effectivePlays * input.days)),
    feasibleFrequency: Math.floor(affordable / (input.vehicles * input.days)),
  };
}

export interface ReachInput {
  target: number;
  targetType: "impressions" | "playbacks";
  days: number;
  vehicles: number;
  adSeconds: number;
  exposure: Exposure;
}

export function estimateReachCampaign(input: ReachInput, cfg: Config = CAMPAIGN_CONFIG) {
  const price = pricePerPlayback(input.adSeconds, cfg);
  const slotCap = maxPlaysPerVehiclePerDay(input.adSeconds, cfg);
  const exposure = cfg.exposure[input.exposure];
  const opportunities = passengerOpportunities(input.vehicles, input.days, cfg);
  const maxImpressions = Math.round(opportunities * exposure);
  const playbacksNeeded =
    input.targetType === "playbacks"
      ? Math.ceil(input.target)
      : Math.ceil(input.target / cfg.passengersPerRide);
  const capacity = input.vehicles * slotCap * input.days;
  const feasible =
    playbacksNeeded <= capacity &&
    (input.targetType === "playbacks" || input.target <= maxImpressions);
  const vehiclesForPlaybacks = Math.ceil(playbacksNeeded / (slotCap * input.days));
  const vehiclesForImpressions =
    input.targetType === "impressions"
      ? Math.ceil(input.target / (cfg.ridesPerVehiclePerDay * cfg.passengersPerRide * input.days * exposure))
      : 0;
  return {
    price,
    playbacksNeeded,
    requiredBudget: round2(playbacksNeeded * price),
    playsPerVehiclePerDay: Math.ceil(playbacksNeeded / (input.vehicles * input.days)),
    capacity,
    maxImpressions,
    feasible,
    recommendedVehicles: Math.max(vehiclesForPlaybacks, vehiclesForImpressions),
  };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-IN");
export const formatINR = (n: number) => inr.format(n);
export const formatINR2 = (n: number) => inr2.format(n);
export const formatNum = (n: number) => num.format(Math.round(n));

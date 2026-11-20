import { describe, expect, it } from "vitest";
import {
  estimateBudgetCampaign,
  estimateReachCampaign,
  formatINR,
  maxPlaysPerVehiclePerDay,
  passengerOpportunities,
  pricePerPlayback,
} from "@/lib/campaign";

const base = { days: 30, vehicles: 1000, playsPerDay: 20, adSeconds: 30, exposure: "base" as const };

describe("campaign pricing", () => {
  it("prices a 30s playback at ₹0.50", () => {
    expect(pricePerPlayback(30)).toBe(0.5);
  });
  it("2-hour window gives 240 slots of 30s per screen", () => {
    expect(maxPlaysPerVehiclePerDay(30)).toBe(240);
  });
  it("240 plays on 1,000 vehicles for 1 day costs ₹1,20,000", () => {
    const r = estimateBudgetCampaign({ ...base, days: 1, playsPerDay: 240, budget: 1_000_000 });
    expect(r.delivered).toBe(240_000);
    expect(r.mediaCost).toBe(120_000);
  });
  it("20 plays × 1,000 vehicles × 30 days = 600,000 playbacks costing ₹3,00,000", () => {
    const r = estimateBudgetCampaign({ ...base, budget: 300_000 });
    expect(r.requested).toBe(600_000);
    expect(r.requestedCost).toBe(300_000);
    expect(r.delivered).toBe(600_000);
    expect(r.unspent).toBe(0);
  });
  it("never exceeds the budget and reports unspent", () => {
    const r = estimateBudgetCampaign({ ...base, budget: 10_000 });
    expect(r.delivered).toBe(20_000);
    expect(r.mediaCost).toBe(10_000);
    expect(r.budgetLimited).toBe(true);
    const r2 = estimateBudgetCampaign({ ...base, vehicles: 10, budget: 10_000 });
    expect(r2.delivered).toBe(6_000);
    expect(r2.unspent).toBe(7_000);
  });
  it("caps frequency at screen slot capacity", () => {
    const r = estimateBudgetCampaign({ ...base, vehicles: 1, days: 1, playsPerDay: 500, budget: 1_000_000 });
    expect(r.delivered).toBe(240);
    expect(r.frequencyCapped).toBe(true);
  });
});

describe("audience estimates", () => {
  it("1,000 vehicles → 24,000 opportunities/day, 720,000 over 30 days", () => {
    expect(passengerOpportunities(1000, 1)).toBe(24_000);
    expect(passengerOpportunities(1000, 15)).toBe(360_000);
    expect(passengerOpportunities(1000, 30)).toBe(720_000);
  });
  it("applies 50% base exposure factor", () => {
    const r = estimateBudgetCampaign({ ...base, budget: 300_000 });
    expect(r.impressions).toBe(360_000);
  });
});

describe("reach mode", () => {
  it("required budget for 100,000 playbacks is ₹50,000", () => {
    const r = estimateReachCampaign({ ...base, target: 100_000, targetType: "playbacks" });
    expect(r.requiredBudget).toBe(50_000);
    expect(r.feasible).toBe(true);
  });
  it("flags infeasible targets", () => {
    const r = estimateReachCampaign({ ...base, vehicles: 1, target: 1_000_000, targetType: "playbacks" });
    expect(r.feasible).toBe(false);
  });
});

it("formats INR with Indian grouping", () => {
  expect(formatINR(100000)).toBe("₹1,00,000");
});

describe("fleet rules", () => {
  it("one auto playing 240 ads in a day costs ₹120", () => {
    const r = estimateBudgetCampaign({ ...base, vehicles: 1, days: 1, playsPerDay: 240, budget: 1e9 });
    expect(r.mediaCost).toBe(120);
  });
  it("₹10,000 buys 20,000 plays", () => {
    const r = estimateBudgetCampaign({ ...base, days: 15, playsPerDay: 240, budget: 10_000 });
    expect(r.delivered).toBe(20_000);
  });
});

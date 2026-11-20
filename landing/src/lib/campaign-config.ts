// Central planning assumptions. Administrators edit these values only — the
// calculation logic in campaign.ts reads everything from here.
export const CAMPAIGN_CONFIG = {
  pricePer30sPlayback: 0.5, // ₹ per 30-second playback on one vehicle
  screenActiveHoursPerDay: 2, // campaign screen activity window
  ridesPerVehiclePerDay: 12,
  passengersPerRide: 2, // midpoint of assumed 1–3
  exposure: { low: 0.3, base: 0.5, high: 0.7 },
  budget: { min: 1000, max: 10_000_000, default: 10_000, presets: [5000, 10000, 25000, 50000, 100000] },
  vehicles: { min: 1, max: 1000, default: 1000 }, // total available auto fleet
  days: { min: 1, max: 365, presets: [15, 30, 60] },
  frequency: { min: 1, max: 100, default: 20, presets: [1, 20, 50, 100] },
  adSeconds: { min: 5, max: 120, presets: [15, 30] },
  inventoryVerified: false, // flip once live inventory data is connected
} as const;

export const BENGALURU_AREAS: { group: string; areas: string[] }[] = [
  {
    group: "Premium residential & commercial",
    areas: ["HSR Layout", "Koramangala", "Indiranagar", "Jayanagar", "JP Nagar", "BTM Layout", "Whitefield", "Electronic City", "Sarjapur Road", "Marathahalli", "Bellandur", "Brookefield"],
  },
  {
    group: "Central & high-footfall",
    areas: ["MG Road", "Brigade Road", "Church Street", "Commercial Street", "Residency Road", "Richmond Road", "Vasanth Nagar", "Malleshwaram", "Rajajinagar", "Vijayanagar", "Banashankari", "Basavanagudi"],
  },
  {
    group: "Additional areas",
    areas: ["Hebbal", "Yelahanka", "KR Puram", "Hennur", "Thanisandra", "Bommanahalli", "Bommasandra", "Attibele"],
  },
];

export const ALL_AREAS = BENGALURU_AREAS.flatMap((g) => g.areas);

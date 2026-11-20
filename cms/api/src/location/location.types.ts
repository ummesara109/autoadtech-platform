export type LiveVehicleLocation = {
  vehicleId: string;
  autoNumber: string;
  deviceId: string | null;
  lat: number;
  lng: number;
  accuracyM: number | null;
  recordedAt: string;
  lastUpdated: string;
  trackingActive: boolean;
  /** Live ingest only — never cms_dev_seed */
  source: 'device_gps';
};

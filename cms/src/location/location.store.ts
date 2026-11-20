import { Injectable } from '@nestjs/common';
import type { LiveVehicleLocation } from './location.types';

/**
 * In-memory live GPS when Supabase is unset / CMS_DEV_AUTH local.
 * Not a simulator — only stores fixes the authenticated client POSTs.
 */
@Injectable()
export class LocationStore {
  private readonly byVehicle = new Map<string, LiveVehicleLocation>();

  upsert(row: LiveVehicleLocation) {
    this.byVehicle.set(row.vehicleId, row);
    return row;
  }

  get(vehicleId: string): LiveVehicleLocation | null {
    return this.byVehicle.get(vehicleId) ?? null;
  }

  markInactive(vehicleId: string): LiveVehicleLocation | null {
    const cur = this.byVehicle.get(vehicleId);
    if (!cur) return null;
    const next: LiveVehicleLocation = {
      ...cur,
      trackingActive: false,
      lastUpdated: new Date().toISOString(),
    };
    this.byVehicle.set(vehicleId, next);
    return next;
  }

  list(): LiveVehicleLocation[] {
    return [...this.byVehicle.values()];
  }
}

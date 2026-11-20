import { WebPlugin } from '@capacitor/core';
import type { NiyoAdsSilentGpsPlugin, SilentGpsStartOptions } from './definitions';

/**
 * Browser stub — real background tracking is Android-only.
 * Web path continues to use navigator.geolocation in silentGps.ts.
 */
export class NiyoAdsSilentGpsWeb
  extends WebPlugin
  implements NiyoAdsSilentGpsPlugin
{
  async start(
    _options: SilentGpsStartOptions,
  ): Promise<{ started: boolean; platform: string }> {
    return { started: false, platform: 'web' };
  }

  async stop(): Promise<{ stopped: boolean }> {
    return { stopped: true };
  }

  async isRunning(): Promise<{ running: boolean }> {
    return { running: false };
  }
}

import { registerPlugin } from '@capacitor/core';
import type { NiyoAdsSilentGpsPlugin } from './definitions';

const NiyoAdsSilentGps = registerPlugin<NiyoAdsSilentGpsPlugin>(
  'NiyoAdsSilentGps',
  {
    web: () => import('./web').then((m) => new m.NiyoAdsSilentGpsWeb()),
  },
);

export * from './definitions';
export { NiyoAdsSilentGps };

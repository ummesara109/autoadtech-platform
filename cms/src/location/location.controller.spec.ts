import type { ConfigService } from '@nestjs/config';
import type { LocationService } from './location.service';
import { LocationController } from './location.controller';

describe('LocationController fleet access', () => {
  it('does not let Production CMS_DEV_AUTH bypass the internal key', () => {
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            CMS_DEV_AUTH: 'true',
            NODE_ENV: 'production',
            VERCEL_ENV: 'production',
            SUPABASE_URL: 'https://project.supabase.co',
          })[key],
      ),
    } as unknown as ConfigService;
    const listFleet = jest.fn();
    const location = { listFleet } as unknown as LocationService;
    const controller = new LocationController(location, config);

    expect(() => controller.fleet()).toThrow(
      'Fleet endpoint requires CMS_INTERNAL_KEY',
    );
    expect(listFleet).not.toHaveBeenCalled();
  });
});

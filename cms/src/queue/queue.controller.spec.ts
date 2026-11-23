import type { ConfigService } from '@nestjs/config';
import type { QueueService } from './queue.service';
import { QueueController } from './queue.controller';

describe('QueueController internal endpoint access', () => {
  it('does not let Production CMS_DEV_AUTH bypass the internal key', () => {
    const config = {
      get: jest.fn(
        (key: string) =>
          ({
            CMS_DEV_AUTH: 'true',
            NODE_ENV: 'production',
            VERCEL_ENV: 'production',
          })[key],
      ),
    } as unknown as ConfigService;
    const enqueue = jest.fn();
    const queue = { enqueue } as unknown as QueueService;
    const controller = new QueueController(queue, config);

    expect(() =>
      controller.assign(undefined, { screenId: 'screen', ads: [] }),
    ).toThrow('CMS_INTERNAL_KEY not configured');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('scopes queue snapshots to the screen in the authenticated session', () => {
    const config = { get: jest.fn() } as unknown as ConfigService;
    const snapshot = jest.fn();
    const queue = { snapshot } as unknown as QueueService;
    const controller = new QueueController(queue, config);

    expect(() =>
      controller.snapshot(
        { cmsSession: { screen: { id: 'screen-a' } } as never },
        { screenId: 'screen-b' },
      ),
    ).toThrow('Screen is not assigned to this session');
    expect(snapshot).not.toHaveBeenCalled();
  });
});

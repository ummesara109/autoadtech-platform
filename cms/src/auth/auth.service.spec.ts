jest.mock('@nestjs/config', () => ({ ConfigService: class ConfigService {} }));
jest.mock('../location/location.service', () => ({
  LocationService: class LocationService {},
}));
jest.mock('../queue/queue.service', () => ({
  QueueService: class QueueService {},
}));
jest.mock('../redis/redis.service', () => ({
  RedisService: class RedisService {},
}));
jest.mock('../supabase/supabase.service', () => ({
  SupabaseService: class SupabaseService {},
}));

import type { ConfigService } from '@nestjs/config';
import type { LocationService } from '../location/location.service';
import type { QueueService } from '../queue/queue.service';
import type { RedisService } from '../redis/redis.service';
import type { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from './auth.service';
import type { SessionPayload } from './auth.types';

describe('AuthService.devAuthEnabled', () => {
  const createAuth = (
    settings: Record<string, string>,
    supabaseConfigured: boolean,
  ) => {
    const config = {
      get: jest.fn((key: string) => settings[key]),
    } as unknown as ConfigService;
    const supabase = { isConfigured: supabaseConfigured } as SupabaseService;
    return new AuthService(
      supabase,
      {} as RedisService,
      config,
      {} as QueueService,
      {} as LocationService,
    );
  };

  it('disables demo auth in production even when explicitly enabled', () => {
    const auth = createAuth(
      {
        CMS_DEV_AUTH: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      },
      true,
    );

    expect(auth.devAuthEnabled).toBe(false);
  });

  it('allows explicitly enabled demo auth on a Vercel Preview deployment', () => {
    const auth = createAuth(
      {
        CMS_DEV_AUTH: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
      },
      true,
    );

    expect(auth.devAuthEnabled).toBe(true);
  });
});

describe('AuthService.logout', () => {
  it('stops the session-bound GPS forwarding before clearing the session', async () => {
    const callOrder: string[] = [];
    const session: SessionPayload = {
      accessToken: 'access-token',
      operator: {
        id: 'operator-id',
        displayName: 'Operator',
        roleCode: 'cms_operator',
        vehicleId: 'vehicle-id',
        autoNumber: 'KA01AB1234',
      },
      screen: {
        id: '33333333-3333-4333-8333-333333333331',
        code: 'LEFT',
        label: 'Left',
        placement: 'left',
      },
      screens: [],
    };
    const redis = {
      get: jest.fn().mockResolvedValue(JSON.stringify(session)),
      del: jest.fn().mockImplementation(async () => {
        callOrder.push('clear-session');
      }),
    } as unknown as RedisService;
    const location = {
      stopForSession: jest.fn().mockImplementation(async () => {
        callOrder.push('stop-gps');
        return { ok: true };
      }),
    } as unknown as LocationService;
    const supabase = { isConfigured: false } as SupabaseService;
    const config = {
      get: jest.fn().mockReturnValue('false'),
    } as unknown as ConfigService;
    const auth = new AuthService(
      supabase,
      redis,
      config,
      {} as QueueService,
      location,
    );

    await auth.logout(session.accessToken);

    expect(location.stopForSession).toHaveBeenCalledWith(session);
    expect(redis.del).toHaveBeenCalledWith('cms:session:access-token');
    expect(callOrder).toEqual(['stop-gps', 'clear-session']);
  });
});

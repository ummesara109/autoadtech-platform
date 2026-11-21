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

type TestRow = Record<string, unknown>;

function createAuthHarness(
  settings: Record<string, string>,
  tables: Record<string, TestRow[]>,
) {
  const challenges = new Map<string, string>();
  const sessions = new Map<string, string>();
  const redis = {
    get: jest.fn(async (key: string) => challenges.get(key) ?? sessions.get(key) ?? null),
    set: jest.fn(async (key: string, value: string) => {
      if (key.startsWith('cms:otp:')) challenges.set(key, value);
      else sessions.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      challenges.delete(key);
      sessions.delete(key);
    }),
  };
  const verifyOtp = jest.fn().mockResolvedValue({
    data: { session: null },
    error: { message: 'Invalid OTP' },
  });
  const from = jest.fn((table: string) => {
    const filters: Array<{
      type: 'eq' | 'ilike' | 'in';
      column: string;
      value: unknown;
    }> = [];
    const matchingRows = () =>
      (tables[table] ?? []).filter((row) =>
        filters.every(({ type, column, value }) => {
          if (type === 'eq') return row[column] === value;
          if (type === 'ilike') {
            return String(row[column] ?? '').toLowerCase() ===
              String(value).toLowerCase();
          }
          return Array.isArray(value) && value.includes(row[column]);
        }),
      );
    const query: {
      select: jest.Mock;
      eq: jest.Mock;
      ilike: jest.Mock;
      in: jest.Mock;
      maybeSingle: jest.Mock;
      then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise<unknown>;
    } = {
      select: jest.fn(() => query),
      eq: jest.fn((column: string, value: unknown) => {
        filters.push({ type: 'eq', column, value });
        return query;
      }),
      ilike: jest.fn((column: string, value: unknown) => {
        filters.push({ type: 'ilike', column, value });
        return query;
      }),
      in: jest.fn((column: string, value: unknown) => {
        filters.push({ type: 'in', column, value });
        return query;
      }),
      maybeSingle: jest.fn(async () => ({
        data: matchingRows()[0] ?? null,
        error: null,
      })),
      then: (resolve, reject) =>
        Promise.resolve({ data: matchingRows(), error: null }).then(
          resolve,
          reject,
        ),
    };
    return query;
  });
  const client = { from, auth: { verifyOtp } };
  const supabase = { isConfigured: true, client } as unknown as SupabaseService;
  const config = {
    get: jest.fn((key: string) => settings[key]),
  } as unknown as ConfigService;
  const queue = {
    ensureDevDemoAdsIfEmpty: jest.fn().mockResolvedValue(undefined),
  } as unknown as QueueService;
  const auth = new AuthService(
    supabase,
    redis as unknown as RedisService,
    config,
    queue,
    {} as LocationService,
  );
  return { auth, redis, verifyOtp, from, queue };
}

function registeredVehicleRows(): Record<string, TestRow[]> {
  const vehicles = [
    { id: 'vehicle-1', auto_number: 'KA01AB0001' },
    { id: 'vehicle-2', auto_number: 'KA02CD0002' },
  ];
  return {
    cms_vehicles: vehicles.map((vehicle) => ({
      ...vehicle,
      display_name: `Owner ${vehicle.id}`,
      make_model: '',
      status: 'active',
      registered_mobile: null,
      mobile_e164: null,
    })),
    cms_operators: vehicles.map((vehicle, index) => ({
      id: `operator-${index + 1}`,
      vehicle_id: vehicle.id,
      display_name: `Operator ${index + 1}`,
      role_code: 'cms_operator',
      is_active: true,
    })),
    cms_screen_assignments: vehicles.map((vehicle, index) => ({
      operator_id: `operator-${index + 1}`,
      screen_id: `screen-${index + 1}`,
    })),
    cms_screens: vehicles.map((vehicle, index) => ({
      id: `screen-${index + 1}`,
      vehicle_id: vehicle.id,
      code: 'REAR',
      label: 'Rear screen',
      placement: 'rear',
      is_active: true,
    })),
  };
}

describe('AuthService demo OTP vehicle flow', () => {
  const previewSettings = {
    CMS_DEV_AUTH: 'true',
    NODE_ENV: 'production',
    VERCEL_ENV: 'preview',
  };

  it('authenticates two registered vehicles without phone numbers using 123456', async () => {
    const { auth, from, queue } = createAuthHarness(
      previewSettings,
      registeredVehicleRows(),
    );

    for (const [autoNumber, vehicleId] of [
      ['KA01AB0001', 'vehicle-1'],
      ['KA02CD0002', 'vehicle-2'],
    ]) {
      const lookup = await auth.lookupAutoNumber(autoNumber);
      expect(lookup.devMode).toBe(true);
      expect(lookup.autoNumber).toBe(autoNumber);
      expect(lookup.maskedMobile).toBe('Demo OTP');

      const session = await auth.verifyOtp(lookup.challengeId, '123456');
      expect(session.operator.vehicleId).toBe(vehicleId);
      expect(session.operator.autoNumber).toBe(autoNumber);
      expect(session.screen.id).toBe(
        vehicleId === 'vehicle-1' ? 'screen-1' : 'screen-2',
      );
    }

    expect(from).not.toHaveBeenCalledWith('cms_otp_challenges');
    expect(queue.ensureDevDemoAdsIfEmpty).toHaveBeenCalledTimes(2);
  });

  it('rejects an unregistered vehicle before issuing a demo challenge', async () => {
    const { auth } = createAuthHarness(
      previewSettings,
      registeredVehicleRows(),
    );

    await expect(auth.lookupAutoNumber('KA99ZZ9999')).rejects.toThrow(
      'No registered vehicle found for this Auto Number',
    );
  });

  it('requires CMS_DEV_AUTH=true explicitly in Preview', () => {
    const { auth } = createAuthHarness(
      {
        CMS_DEV_AUTH: 'false',
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
      },
      {},
    );

    expect(auth.devAuthEnabled).toBe(false);
  });

  it('does not accept 123456 as demo auth in Production', async () => {
    const { auth, verifyOtp, redis } = createAuthHarness(
      {
        CMS_DEV_AUTH: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      },
      {},
    );
    const challenge = {
      challengeId: 'production-challenge',
      vehicleId: 'vehicle-1',
      operatorId: 'operator-1',
      autoNumber: 'KA01AB0001',
      maskedMobile: '******1234',
      mobileE164: '+919876543210',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      createdAt: new Date().toISOString(),
    };
    await redis.set(
      'cms:otp:production-challenge',
      JSON.stringify(challenge),
    );

    await expect(
      auth.verifyOtp('production-challenge', '123456'),
    ).rejects.toThrow('Invalid OTP');
    expect(verifyOtp).toHaveBeenCalledWith({
      phone: '+919876543210',
      token: '123456',
      type: 'sms',
    });
  });

  it('disables demo auth for production Node deployments without Vercel metadata', () => {
    const { auth } = createAuthHarness(
      {
        CMS_DEV_AUTH: 'true',
        NODE_ENV: 'production',
      },
      {},
    );

    expect(auth.devAuthEnabled).toBe(false);
  });
});

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

  it('preserves local seeded demo auth when Supabase is not configured', () => {
    const auth = createAuth({ NODE_ENV: 'development' }, false);

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

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
import { validate } from 'class-validator';
import type { LocationService } from '../location/location.service';
import type { QueueService } from '../queue/queue.service';
import type { RedisService } from '../redis/redis.service';
import type { SupabaseService } from '../supabase/supabase.service';
import { AuthService } from './auth.service';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import type { SessionPayload } from './auth.types';

type TestRow = Record<string, unknown>;

function createAuthHarness(
  settings: Record<string, string>,
  tables: Record<string, TestRow[]>,
) {
  const challenges = new Map<string, string>();
  const sessions = new Map<string, string>();
  const counters = new Map<string, number>();
  const redis = {
    isAvailable: true,
    get: jest.fn(
      async (key: string) => challenges.get(key) ?? sessions.get(key) ?? null,
    ),
    set: jest.fn(async (key: string, value: string) => {
      if (key.startsWith('cms:otp:')) challenges.set(key, value);
      else sessions.set(key, value);
    }),
    del: jest.fn(async (key: string) => {
      challenges.delete(key);
      sessions.delete(key);
      counters.delete(key);
    }),
    incrementWithTtl: jest.fn(async (key: string) => {
      const count = (counters.get(key) ?? 0) + 1;
      counters.set(key, count);
      return count;
    }),
  };
  const verifyOtp = jest.fn().mockResolvedValue({
    data: { session: null },
    error: { message: 'Invalid OTP' },
  });
  const signInWithOtp = jest.fn().mockResolvedValue({ error: null });
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
            return (
              String(row[column] ?? '').toLowerCase() ===
              String(value).toLowerCase()
            );
          }
          return Array.isArray(value) && value.includes(row[column]);
        }),
      );
    const query: {
      select: jest.Mock;
      eq: jest.Mock;
      ilike: jest.Mock;
      in: jest.Mock;
      update: jest.Mock;
      insert: jest.Mock;
      maybeSingle: jest.Mock;
      then: (
        resolve: (value: unknown) => unknown,
        reject: (error: unknown) => unknown,
      ) => Promise<unknown>;
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
      update: jest.fn(() => query),
      insert: jest.fn(() => query),
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
  const client = { from, auth: { verifyOtp, signInWithOtp } };
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
  return { auth, redis, verifyOtp, signInWithOtp, from, queue };
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
    CMS_DEMO_VEHICLES: 'KA01AB0001,KA02CD0002',
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

  it('rejects a registered demo vehicle without an active assigned screen', async () => {
    const tables = registeredVehicleRows();
    tables.cms_screen_assignments = [];
    const { auth, signInWithOtp } = createAuthHarness(previewSettings, tables);

    await expect(auth.lookupAutoNumber('KA01AB0001')).rejects.toThrow(
      'No screen assigned to this Auto Number',
    );
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('supports the temporary Production demo flow without Redis or Supabase SMS', async () => {
    const tables = registeredVehicleRows();
    tables.cms_vehicles[0].auto_number = 'KA01AB0000';
    const { auth, verifyOtp, signInWithOtp, from, redis } = createAuthHarness(
      {
        CMS_DEMO_AUTH: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
      },
      tables,
    );
    redis.isAvailable = false;

    const lookup = await auth.lookupAutoNumber('KA01 AB 0000');
    expect(lookup.devMode).toBe(true);
    expect(lookup.autoNumber).toBe('KA01AB0000');
    expect(lookup.maskedMobile).toBe('Demo OTP');
    const verifyDto = Object.assign(new VerifyOtpDto(), {
      challengeId: lookup.challengeId,
      otp: '123456',
    });
    const resendDto = Object.assign(new ResendOtpDto(), {
      challengeId: lookup.challengeId,
    });
    expect(await validate(verifyDto)).toHaveLength(0);
    expect(await validate(resendDto)).toHaveLength(0);
    const resend = await auth.resendOtp(lookup.challengeId);
    expect(resend.devMode).toBe(true);
    expect(resend.message).toBe('Demo OTP ready');
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(redis.incrementWithTtl).not.toHaveBeenCalled();

    await expect(auth.verifyOtp(lookup.challengeId, '000000')).rejects.toThrow(
      'Invalid OTP',
    );

    const session = await auth.verifyOtp(lookup.challengeId, '123456');
    expect(session.accessToken).toMatch(/^cms-demo-session\./);
    expect(session.operator.vehicleId).toBe('vehicle-1');
    expect(session.operator.autoNumber).toBe('KA01AB0000');
    expect(session.screen.id).toBe('screen-1');
    const tamperedToken = `${session.accessToken.slice(0, -1)}${
      session.accessToken.endsWith('A') ? 'B' : 'A'
    }`;
    await expect(auth.resolveSession(tamperedToken)).rejects.toThrow(
      'Invalid or expired demo session',
    );
    expect(signInWithOtp).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalledWith('cms_otp_challenges');
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();

    const resolved = await auth.resolveSession(session.accessToken);
    expect(resolved.operator.autoNumber).toBe('KA01AB0000');
    expect(resolved.screen.id).toBe('screen-1');
    expect(redis.get).not.toHaveBeenCalled();
  });

  it('disables temporary demo sessions when CMS_DEMO_AUTH is turned off', async () => {
    const settings = {
      CMS_DEMO_AUTH: 'true',
      NODE_ENV: 'production',
      VERCEL_ENV: 'production',
      SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
    };
    const tables = registeredVehicleRows();
    tables.cms_vehicles[0].auto_number = 'KA01AB0000';
    const { auth } = createAuthHarness(settings, tables);
    const lookup = await auth.lookupAutoNumber('KA01AB0000');
    const session = await auth.verifyOtp(lookup.challengeId, '123456');

    settings.CMS_DEMO_AUTH = 'false';
    await expect(auth.resolveSession(session.accessToken)).rejects.toThrow(
      'Invalid or expired demo session',
    );
  });

  it('uses Supabase SMS for the temporary demo plate when CMS_DEMO_AUTH is off', async () => {
    const tables = registeredVehicleRows();
    tables.cms_vehicles[0].auto_number = 'KA01AB0000';
    tables.cms_vehicles[0].registered_mobile = '9876543210';
    tables.cms_vehicles[0].mobile_e164 = '+919876543210';
    const { auth, signInWithOtp, verifyOtp } = createAuthHarness(
      {
        CMS_DEMO_AUTH: 'false',
        CMS_DEV_AUTH: 'false',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      },
      tables,
    );

    const lookup = await auth.lookupAutoNumber('KA01-AB 0000');

    expect(lookup.devMode).toBe(false);
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: '+919876543210' });
    await expect(auth.verifyOtp(lookup.challengeId, '123456')).rejects.toThrow(
      'Invalid or expired OTP',
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      phone: '+919876543210',
      token: '123456',
      type: 'sms',
    });
  });

  it('rate limits temporary demo lookups without Redis', async () => {
    const tables = registeredVehicleRows();
    tables.cms_vehicles[0].auto_number = 'KA01AB0000';
    const { auth, redis } = createAuthHarness(
      {
        CMS_DEMO_AUTH: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
      },
      tables,
    );
    redis.isAvailable = false;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await auth.lookupAutoNumber('KA01AB0000');
    }

    await expect(auth.lookupAutoNumber('KA01AB0000')).rejects.toThrow(
      'Too many demo OTP requests.',
    );
    expect(redis.incrementWithTtl).not.toHaveBeenCalled();
  });

  it('requires the registered Supabase demo vehicle and rejects other vehicles from demo OTP', async () => {
    const tables = registeredVehicleRows();
    tables.cms_vehicles[0].auto_number = 'KA01AB0000';
    tables.cms_vehicles[1].registered_mobile = '9999999999';
    tables.cms_vehicles[1].mobile_e164 = '+919999999999';
    const { auth, signInWithOtp, redis } = createAuthHarness(
      {
        CMS_DEMO_AUTH: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        SUPABASE_SECRET_KEY: 'test-server-key',
      },
      tables,
    );

    await expect(auth.lookupAutoNumber('KA99ZZ9999')).rejects.toThrow(
      'No registered vehicle found for this Auto Number',
    );

    const otherVehicle = await auth.lookupAutoNumber('KA02CD0002');
    expect(otherVehicle.devMode).toBe(false);
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: '+919999999999' });
    expect(redis.set).toHaveBeenCalled();
  });

  it('does not use Redis or development seeds when the demo plate is unregistered', async () => {
    const { auth, redis, signInWithOtp } = createAuthHarness(
      {
        CMS_DEMO_AUTH: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
        SUPABASE_SERVICE_ROLE_KEY: 'test-server-key',
      },
      registeredVehicleRows(),
    );
    redis.isAvailable = false;

    await expect(auth.lookupAutoNumber('KA01AB0000')).rejects.toThrow(
      'No registered vehicle found for this Auto Number',
    );
    expect(redis.incrementWithTtl).not.toHaveBeenCalled();
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('does not enable Production demo OTP from CMS_DEV_AUTH alone', async () => {
    const tables = registeredVehicleRows();
    const { auth, signInWithOtp } = createAuthHarness(
      {
        CMS_DEV_AUTH: 'true',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      },
      tables,
    );

    await expect(auth.lookupAutoNumber('KA01AB0001')).rejects.toThrow(
      'No valid Indian operator phone is provisioned',
    );
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('rate limits repeated lookups for the same vehicle', async () => {
    const { auth, redis } = createAuthHarness(
      previewSettings,
      registeredVehicleRows(),
    );

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await auth.lookupAutoNumber('KA01AB0001');
    }

    await expect(auth.lookupAutoNumber('KA01AB0001')).rejects.toThrow(
      'Too many OTP requests for this vehicle.',
    );
    expect(redis.incrementWithTtl).toHaveBeenCalledTimes(6);
  });

  it('continues normal OTP for non-demo Production vehicles', async () => {
    const tables = registeredVehicleRows();
    tables.cms_vehicles[0].auto_number = 'KA01AB5555';
    tables.cms_vehicles[0].registered_mobile = '9876543210';
    tables.cms_vehicles[0].mobile_e164 = '+919876543210';
    tables.cms_vehicles[1].registered_mobile = '9999999999';
    tables.cms_vehicles[1].mobile_e164 = '+919999999999';
    const { auth, signInWithOtp, verifyOtp } = createAuthHarness(
      {
        CMS_DEV_AUTH: 'false',
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      },
      tables,
    );

    const lookup = await auth.lookupAutoNumber('KA02CD0002');
    expect(lookup.devMode).toBe(false);
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: '+919999999999' });
    await expect(auth.verifyOtp(lookup.challengeId, '123456')).rejects.toThrow(
      'Invalid or expired OTP',
    );
    expect(verifyOtp).toHaveBeenCalledWith({
      phone: '+919999999999',
      token: '123456',
      type: 'sms',
    });
  });

  it('returns a sanitized actionable message when Supabase SMS is not configured', async () => {
    const tables = registeredVehicleRows();
    tables.cms_vehicles[0].registered_mobile = '9876543210';
    tables.cms_vehicles[0].mobile_e164 = '+919876543210';
    const { auth, signInWithOtp } = createAuthHarness(
      {
        NODE_ENV: 'production',
        VERCEL_ENV: 'production',
      },
      tables,
    );
    signInWithOtp.mockResolvedValueOnce({
      error: {
        code: 'sms_provider_not_configured',
        status: 500,
        message: 'SMS provider is not configured for +919876543210',
      },
    });

    await expect(auth.lookupAutoNumber('KA01AB0001')).rejects.toThrow(
      /Configure and enable a Phone SMS provider.*code sms_provider_not_configured/,
    );
  });

  it('does not issue OTPs from a Vercel instance without shared Redis storage', async () => {
    const { auth, redis, signInWithOtp } = createAuthHarness(
      {
        VERCEL: '1',
        VERCEL_ENV: 'production',
      },
      registeredVehicleRows(),
    );
    redis.isAvailable = false;

    await expect(auth.lookupAutoNumber('KA01AB0001')).rejects.toThrow(
      'Shared OTP storage is unavailable. Configure REDIS_URL',
    );
    expect(signInWithOtp).not.toHaveBeenCalled();
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

  it('accepts uppercase CMS_DEV_AUTH values in Preview', () => {
    const { auth } = createAuthHarness(
      {
        CMS_DEV_AUTH: 'TRUE',
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
      },
      {},
    );

    expect(auth.devAuthEnabled).toBe(true);
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
    await redis.set('cms:otp:production-challenge', JSON.stringify(challenge));

    await expect(
      auth.verifyOtp('production-challenge', '123456'),
    ).rejects.toThrow('Invalid or expired OTP');
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

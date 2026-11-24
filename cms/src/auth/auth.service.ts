import {
  BadRequestException,
  Inject,
  Injectable,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ForbiddenException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { maskMobile, normalizeAutoNumber } from '../common/mask-mobile';
import { RedisService } from '../redis/redis.service';
import { SupabaseService } from '../supabase/supabase.service';
import { QueueService } from '../queue/queue.service';
import { LocationService } from '../location/location.service';
import { DEV_OTP, DEV_SEED } from './dev-seed';
import { CMS_DEMO_SESSION_PREFIX } from './auth.constants';
import type { OtpChallenge, SessionPayload } from './auth.types';

const CHALLENGE_TTL_SEC = 5 * 60;
const SESSION_CACHE_TTL_SEC = 15 * 60;
const SESSION_REVALIDATE_MS = 30_000;
const DEFAULT_DEMO_AUTONUMBERS = ['KA01AB1234', 'KA02CD5678'];
const TEMP_DEMO_AUTONUMBER = 'KA01AB0000';
const ADDITIONAL_DEMO_OTP_ENV_KEYS: Record<string, string> = {
  KA01AB0001: 'CMS_DEMO_OTP_KA01AB0001',
  KA01AB0002: 'CMS_DEMO_OTP_KA01AB0002',
  KA01AB0003: 'CMS_DEMO_OTP_KA01AB0003',
  KA01AB0004: 'CMS_DEMO_OTP_KA01AB0004',
};
const MAX_CONFIGURED_DEMO_OTP_ATTEMPTS = 5;
const DEMO_PLAYBACK_AUTONUMBERS = [
  'KA01AB0000',
  'KA01AB0001',
  'KA01AB0002',
  'KA01AB0003',
  'KA01AB0004',
];
const TEMP_DEMO_CHALLENGE_PREFIX = 'cms-demo-challenge';

type TemporaryDemoClaims = {
  jti: string;
  vehicleId: string;
  operatorId: string;
  autoNumber: string;
  screenId: string;
  exp: number;
};

function normalizeIndianPhone(raw: string | undefined): {
  nationalNumber: string;
  mobileE164: string;
} | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  let nationalNumber = '';
  if (digits.length === 10) {
    nationalNumber = digits;
  } else if (digits.length === 11 && digits.startsWith('0')) {
    nationalNumber = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    nationalNumber = digits.slice(2);
  }
  if (!/^[6-9]\d{9}$/.test(nationalNumber)) return null;
  return { nationalNumber, mobileE164: `+91${nationalNumber}` };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null | undefined {
  return value === null || value === undefined || typeof value === 'string';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly temporaryDemoRateLimits = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => QueueService))
    private readonly queue: QueueService,
    @Inject(forwardRef(() => LocationService))
    private readonly location: LocationService,
  ) {}

  private isProductionDeployment() {
    const vercelEnv = this.config.get<string>('VERCEL_ENV');
    return (
      vercelEnv === 'production' ||
      (this.config.get<string>('NODE_ENV') === 'production' &&
        vercelEnv !== 'preview')
    );
  }

  get devAuthEnabled() {
    if (this.isProductionDeployment()) return false;

    const vercelEnv = this.config.get<string>('VERCEL_ENV');
    const explicitlyEnabled =
      this.config.get<string>('CMS_DEV_AUTH')?.trim().toLowerCase() === 'true';
    if (vercelEnv === 'preview') return explicitlyEnabled;
    return explicitlyEnabled || !this.supabase.isConfigured;
  }

  private isConfiguredDemoVehicle(autoNumber: string) {
    const configured = this.config.get<string>('CMS_DEMO_VEHICLES');
    const allowedAutoNumbers = (
      configured === undefined
        ? DEFAULT_DEMO_AUTONUMBERS
        : configured.split(',')
    )
      .map((value) => normalizeAutoNumber(value.trim()))
      .filter(Boolean);
    return allowedAutoNumbers.includes(normalizeAutoNumber(autoNumber));
  }

  private demoAuthRequested() {
    if (this.isProductionDeployment()) return false;
    const cmsDevAuth =
      this.config.get<string>('CMS_DEV_AUTH')?.trim().toLowerCase() === 'true';
    return cmsDevAuth || !this.supabase.isConfigured;
  }

  private localAutoNumberAuthEnabled() {
    return (
      this.config.get<string>('NODE_ENV') === 'development' &&
      !this.config.get<string>('VERCEL') &&
      !this.config.get<string>('VERCEL_ENV') &&
      this.config.get<string>('CMS_DEV_AUTH')?.trim().toLowerCase() ===
        'true' &&
      this.config
        .get<string>('CMS_LOCAL_AUTO_NUMBER_AUTH')
        ?.trim()
        .toLowerCase() === 'true'
    );
  }

  private localDemoOtpEnabledForVehicle(autoNumber: string) {
    return (
      this.localAutoNumberAuthEnabled() ||
      this.demoOtpEnabledForVehicle(autoNumber)
    );
  }

  private temporaryDemoAuthEnabled(autoNumber: string) {
    return (
      this.config.get<string>('CMS_DEMO_AUTH')?.trim().toLowerCase() ===
        'true' &&
      (normalizeAutoNumber(autoNumber) === TEMP_DEMO_AUTONUMBER ||
        Boolean(ADDITIONAL_DEMO_OTP_ENV_KEYS[normalizeAutoNumber(autoNumber)]))
    );
  }

  private additionalDemoOtpEnvKey(autoNumber: string) {
    if (
      this.config.get<string>('CMS_DEMO_AUTH')?.trim().toLowerCase() !==
      'true'
    ) {
      return undefined;
    }
    return ADDITIONAL_DEMO_OTP_ENV_KEYS[normalizeAutoNumber(autoNumber)];
  }

  private configuredAdditionalDemoOtp(autoNumber: string) {
    const envKey = this.additionalDemoOtpEnvKey(autoNumber);
    if (!envKey) {
      throw new UnauthorizedException('Demo OTP is no longer enabled');
    }

    const otp = this.config.get<string>(envKey)?.trim();
    if (!otp || !/^\d{6}$/.test(otp)) {
      throw new ServiceUnavailableException(
        'Demo OTP configuration is unavailable on the CMS server.',
      );
    }
    return otp;
  }

  private temporaryDemoOtp(autoNumber: string) {
    const normalized = normalizeAutoNumber(autoNumber);
    if (normalized === TEMP_DEMO_AUTONUMBER) return DEV_OTP;
    return this.configuredAdditionalDemoOtp(normalized);
  }

  private matchesOtp(provided: string, expected: string) {
    if (!/^\d{6}$/.test(provided) || !/^\d{6}$/.test(expected)) return false;
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  }

  isDesignatedDemoPlaybackVehicle(autoNumber: string) {
    return DEMO_PLAYBACK_AUTONUMBERS.includes(normalizeAutoNumber(autoNumber));
  }

  private demoOtpEnabledForVehicle(autoNumber: string) {
    if (this.isProductionDeployment()) {
      return (
        this.temporaryDemoAuthEnabled(autoNumber) ||
        Boolean(this.additionalDemoOtpEnvKey(autoNumber))
      );
    }
    return this.demoAuthRequested() && this.isConfiguredDemoVehicle(autoNumber);
  }

  private enforceTemporaryDemoRateLimit(
    scope: string,
    key: string,
    limit: number,
    ttlSeconds: number,
    message: string,
  ) {
    const now = Date.now();
    const id = this.rateLimitKey(scope, key);
    const current = this.temporaryDemoRateLimits.get(id);
    if (!current || current.expiresAt <= now) {
      this.temporaryDemoRateLimits.set(id, {
        count: 1,
        expiresAt: now + ttlSeconds * 1000,
      });
    } else {
      if (current.count >= limit) {
        this.logger.warn(`Temporary demo OTP rate limit exceeded for ${scope}`);
        throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
      }
      current.count += 1;
    }

    if (this.temporaryDemoRateLimits.size > 1_000) {
      for (const [rateKey, value] of this.temporaryDemoRateLimits) {
        if (value.expiresAt <= now)
          this.temporaryDemoRateLimits.delete(rateKey);
      }
    }
  }

  private temporaryDemoSigningKey() {
    const supabaseKey =
      this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY')?.trim() ||
      this.config.get<string>('SUPABASE_SECRET_KEY')?.trim();
    if (!this.supabase.isConfigured || !supabaseKey) {
      throw new ServiceUnavailableException(
        'Demo OTP requires the configured Supabase vehicle registry and server-side key.',
      );
    }
    return createHash('sha256')
      .update(`niyo-cms-temporary-demo-v1\0${supabaseKey}`)
      .digest();
  }

  private signTemporaryDemoToken(prefix: string, claims: TemporaryDemoClaims) {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signingInput = `${prefix}.${payload}`;
    const signature = createHmac('sha256', this.temporaryDemoSigningKey())
      .update(signingInput)
      .digest('base64url');
    return `${signingInput}.${signature}`;
  }

  private verifyTemporaryDemoToken(
    token: string,
    prefix: string,
  ): TemporaryDemoClaims {
    const [tokenPrefix, encodedPayload, encodedSignature, ...extra] =
      token.split('.');
    if (
      tokenPrefix !== prefix ||
      !encodedPayload ||
      !encodedSignature ||
      extra.length
    ) {
      throw new UnauthorizedException('Invalid or expired demo session');
    }

    const signingInput = `${tokenPrefix}.${encodedPayload}`;
    const expected = createHmac('sha256', this.temporaryDemoSigningKey())
      .update(signingInput)
      .digest();
    const actual = Buffer.from(encodedSignature, 'base64url');
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new UnauthorizedException('Invalid or expired demo session');
    }

    let payload: unknown;
    try {
      payload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as unknown;
    } catch {
      throw new UnauthorizedException('Invalid or expired demo session');
    }
    if (
      !isRecord(payload) ||
      typeof payload.jti !== 'string' ||
      typeof payload.vehicleId !== 'string' ||
      typeof payload.operatorId !== 'string' ||
      typeof payload.autoNumber !== 'string' ||
      typeof payload.screenId !== 'string' ||
      typeof payload.exp !== 'number' ||
      !Number.isInteger(payload.exp)
    ) {
      throw new UnauthorizedException('Invalid or expired demo session');
    }
    if (payload.exp <= Math.floor(Date.now() / 1000)) {
      if (prefix === TEMP_DEMO_CHALLENGE_PREFIX) {
        this.logger.warn(
          `Temporary demo OTP challenge expired for ${normalizeAutoNumber(payload.autoNumber)}`,
        );
      }
      throw new UnauthorizedException('Invalid or expired demo session');
    }
    if (!this.temporaryDemoAuthEnabled(payload.autoNumber)) {
      throw new UnauthorizedException('Invalid or expired demo session');
    }
    return {
      jti: payload.jti,
      vehicleId: payload.vehicleId,
      operatorId: payload.operatorId,
      autoNumber: payload.autoNumber,
      screenId: payload.screenId,
      exp: payload.exp,
    };
  }

  private async enforceOtpRateLimit(
    key: string,
    limit: number,
    ttlSeconds: number,
    message: string,
  ) {
    const count = await this.redis.incrementWithTtl(key, ttlSeconds);
    if (count > limit) {
      throw new HttpException(message, HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  private rateLimitKey(scope: string, value: string) {
    const hash = createHash('sha256').update(value).digest('hex');
    return `cms:auth:rate:${scope}:${hash}`;
  }

  private challengeOtpMode(challenge: OtpChallenge) {
    return (
      challenge.otpMode ??
      (this.demoOtpEnabledForVehicle(challenge.autoNumber)
        ? 'local_demo'
        : 'sms')
    );
  }

  private ensureSharedOtpStorage() {
    const vercelEnv = this.config.get<string>('VERCEL_ENV');
    const serverlessDeployment = Boolean(
      this.config.get<string>('VERCEL') ||
      vercelEnv === 'production' ||
      vercelEnv === 'preview',
    );
    if (serverlessDeployment && this.redis.isAvailable !== true) {
      throw new ServiceUnavailableException(
        'Shared OTP storage is unavailable. Configure REDIS_URL for this Vercel environment and verify the Redis connection.',
      );
    }
  }

  async lookupAutoNumber(autoNumberRaw: string) {
    const autoNumber = normalizeAutoNumber(autoNumberRaw);
    const localAutoNumberAuth = this.localAutoNumberAuthEnabled();
    const temporaryDemo =
      !localAutoNumberAuth && this.temporaryDemoAuthEnabled(autoNumber);
    if (localAutoNumberAuth && !this.supabase.isConfigured) {
      throw new ServiceUnavailableException(
        'Local Auto Number testing requires the configured CMS and Admin Supabase registry.',
      );
    }
    if (temporaryDemo) {
      this.enforceTemporaryDemoRateLimit(
        'demo-lookup',
        autoNumber,
        5,
        60,
        'Too many demo OTP requests. Wait one minute and try again.',
      );
      if (!this.supabase.isConfigured) {
        throw new ServiceUnavailableException(
          'Demo OTP requires the configured Supabase vehicle registry and server-side key.',
        );
      }
      if (autoNumber !== TEMP_DEMO_AUTONUMBER) {
        this.configuredAdditionalDemoOtp(autoNumber);
      }
    } else {
      this.ensureSharedOtpStorage();
    }

    const vehicle = await this.findVehicle(autoNumber);
    if (!vehicle) {
      throw new NotFoundException(
        localAutoNumberAuth
          ? 'This Auto Number is not registered for CMS display. Register it in Admin and complete its CMS screen mapping.'
          : 'No registered vehicle found for this Auto Number',
      );
    }
    if (vehicle.status !== 'active') {
      throw new BadRequestException('Vehicle is not active for CMS login');
    }

    const operator = await this.findOperatorByVehicle(vehicle.id);
    if (!operator || !operator.isActive) {
      throw new NotFoundException('No active operator for this vehicle');
    }
    const screen = await this.requireSingleScreenForOperator(
      operator.id,
      vehicle.id,
    );
    if (localAutoNumberAuth) {
      await this.assertRegisteredDisplayDevice(
        vehicle.id,
        screen.id,
        vehicle.autoNumber,
      );
    }

    if (temporaryDemo) {
      const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SEC * 1000);
      const challengeId = this.signTemporaryDemoToken(
        TEMP_DEMO_CHALLENGE_PREFIX,
        {
          jti: randomUUID(),
          vehicleId: vehicle.id,
          operatorId: operator.id,
          autoNumber: vehicle.autoNumber,
          screenId: screen.id,
          exp: Math.floor(expiresAt.getTime() / 1000),
        },
      );
      this.logger.log(
        `Temporary demo OTP challenge created for ${vehicle.autoNumber}`,
      );
      return {
        challengeId,
        maskedMobile: 'Demo OTP',
        expiresAt: expiresAt.toISOString(),
        expiresInSec: CHALLENGE_TTL_SEC,
        autoNumber: vehicle.autoNumber,
        devMode: true,
      };
    }

    const demoAuthRequested = this.demoAuthRequested();
    const localDemo =
      localAutoNumberAuth || this.demoOtpEnabledForVehicle(vehicle.autoNumber);
    if (demoAuthRequested && !localDemo) {
      throw new ForbiddenException(
        'Demo OTP is restricted to the configured demo vehicles.',
      );
    }
    const otpMode = localDemo ? 'local_demo' : 'sms';
    const configuredDemoOtp =
      !temporaryDemo &&
      Boolean(this.additionalDemoOtpEnvKey(vehicle.autoNumber));
    const effectiveOtpMode = configuredDemoOtp ? 'configured_demo' : otpMode;
    if (effectiveOtpMode === 'configured_demo') {
      this.configuredAdditionalDemoOtp(vehicle.autoNumber);
    }
    const operatorPhone = normalizeIndianPhone(vehicle.mobileE164);
    if (effectiveOtpMode === 'sms' && !operatorPhone) {
      throw new BadRequestException(
        'No valid Indian operator phone is provisioned for this vehicle. Add it to the vehicle or its assigned partner in Admin.',
      );
    }
    await this.enforceOtpRateLimit(
      this.rateLimitKey('lookup', autoNumber),
      5,
      60,
      'Too many OTP requests for this vehicle. Wait one minute and try again.',
    );

    const demoMode = effectiveOtpMode !== 'sms';
    const masked = demoMode
      ? 'Demo OTP'
      : maskMobile(operatorPhone?.nationalNumber ?? '');
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SEC * 1000);

    const challenge: OtpChallenge = {
      challengeId,
      vehicleId: vehicle.id,
      operatorId: operator.id,
      autoNumber: vehicle.autoNumber,
      maskedMobile: masked,
      mobileE164:
        effectiveOtpMode === 'sms' ? operatorPhone?.mobileE164 : undefined,
      otpMode: effectiveOtpMode,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };

    await this.redis.set(
      this.challengeKey(challengeId),
      JSON.stringify(challenge),
      CHALLENGE_TTL_SEC,
    );

    await this.startOtp(challenge);

    if (effectiveOtpMode === 'configured_demo') {
      this.logger.log(
        `Configured demo OTP challenge issued for ${vehicle.autoNumber}`,
      );
    }

    if (this.supabase.isConfigured && effectiveOtpMode === 'sms') {
      try {
        const { error } = await this.supabase.client
          .from('cms_otp_challenges')
          .insert({
            id: challengeId,
            vehicle_id: vehicle.id,
            masked_mobile: masked,
            supabase_phone: vehicle.mobileE164,
            expires_at: expiresAt.toISOString(),
          });
        if (error) {
          const code = /^[a-z0-9_-]{1,64}$/i.test(String(error.code ?? ''))
            ? ` (${error.code})`
            : '';
          this.logger.warn(`OTP challenge audit insert failed${code}`);
        }
      } catch (err) {
        const errorName = err instanceof Error ? err.name : 'UnknownError';
        this.logger.warn(
          `OTP challenge audit insert failed before response (${errorName})`,
        );
      }
    }

    return {
      challengeId,
      maskedMobile: masked,
      expiresAt: expiresAt.toISOString(),
      expiresInSec: CHALLENGE_TTL_SEC,
      autoNumber: vehicle.autoNumber,
      devMode: demoMode,
      localDevelopmentAuth: localAutoNumberAuth,
    };
  }

  async resendOtp(challengeId: string) {
    if (challengeId.startsWith(`${TEMP_DEMO_CHALLENGE_PREFIX}.`)) {
      const claims = this.verifyTemporaryDemoToken(
        challengeId,
        TEMP_DEMO_CHALLENGE_PREFIX,
      );
      this.enforceTemporaryDemoRateLimit(
        'demo-resend',
        claims.jti,
        3,
        60,
        'Too many demo OTP resend requests. Wait one minute and try again.',
      );
      this.logger.log(
        `Temporary demo OTP challenge resent for ${claims.autoNumber}`,
      );
      return {
        challengeId,
        maskedMobile: 'Demo OTP',
        expiresAt: new Date(claims.exp * 1000).toISOString(),
        message: 'Demo OTP ready',
        devMode: true,
      };
    }

    this.ensureSharedOtpStorage();
    const challenge = await this.getChallenge(challengeId);
    if (!challenge) {
      throw new BadRequestException('OTP challenge expired or invalid');
    }
    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      if (challenge.otpMode === 'configured_demo') {
        this.logger.warn(
          `Configured demo OTP challenge expired for ${challenge.autoNumber}`,
        );
      }
      throw new BadRequestException('OTP challenge expired');
    }
    await this.enforceOtpRateLimit(
      this.rateLimitKey('resend', challengeId),
      3,
      60,
      'Too many resend requests. Wait one minute before trying again.',
    );
    await this.startOtp(challenge);
    const otpMode = this.challengeOtpMode(challenge);
    if (otpMode === 'configured_demo') {
      this.logger.log(
        `Configured demo OTP challenge resent for ${challenge.autoNumber}`,
      );
      return {
        challengeId,
        maskedMobile: challenge.maskedMobile,
        expiresAt: challenge.expiresAt,
        message: 'Demo OTP ready',
        devMode: true,
        localDevelopmentAuth: false,
      };
    }
    return {
      challengeId,
      maskedMobile: challenge.maskedMobile,
      expiresAt: challenge.expiresAt,
      message: 'OTP resent',
      devMode: otpMode !== 'sms',
      localDevelopmentAuth: this.localAutoNumberAuthEnabled(),
    };
  }

  async verifyOtp(challengeId: string, otp: string): Promise<SessionPayload> {
    if (challengeId.startsWith(`${TEMP_DEMO_CHALLENGE_PREFIX}.`)) {
      return this.verifyTemporaryDemoOtp(challengeId, otp);
    }

    this.ensureSharedOtpStorage();
    const challenge = await this.getChallenge(challengeId);
    if (!challenge) {
      throw new BadRequestException('OTP challenge expired or invalid');
    }
    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      if (challenge.otpMode === 'configured_demo') {
        this.logger.warn(
          `Configured demo OTP challenge expired for ${challenge.autoNumber}`,
        );
      }
      await this.redis.del(this.challengeKey(challengeId));
      throw new BadRequestException('OTP expired — request a new code');
    }
    const otpMode = this.challengeOtpMode(challenge);
    const verifyRateKey = this.rateLimitKey('verify', challengeId);
    await this.enforceOtpRateLimit(
      verifyRateKey,
      5,
      CHALLENGE_TTL_SEC,
      'Too many verification attempts. Request a new OTP.',
    );

    let accessToken: string;
    let refreshToken: string | undefined;
    let expiresIn: number | undefined;
    let authUserId: string | undefined;

    if (otpMode === 'configured_demo') {
      const expectedOtp = this.configuredAdditionalDemoOtp(
        challenge.autoNumber,
      );
      if (!this.matchesOtp(otp, expectedOtp)) {
        const invalidAttemptKey = this.rateLimitKey(
          'demo-invalid',
          challengeId,
        );
        const attempts = await this.redis.incrementWithTtl(
          invalidAttemptKey,
          CHALLENGE_TTL_SEC,
        );
        this.logger.warn(
          `Configured demo OTP verification failed for ${challenge.autoNumber}`,
        );
        if (attempts >= MAX_CONFIGURED_DEMO_OTP_ATTEMPTS) {
          await this.redis.del(this.challengeKey(challengeId));
          await this.redis.del(verifyRateKey);
          this.logger.warn(
            `Configured demo OTP challenge locked after maximum attempts for ${challenge.autoNumber}`,
          );
        }
        throw new UnauthorizedException('Invalid OTP');
      }
      accessToken = `dev.${challenge.operatorId}.${randomUUID()}`;
      expiresIn = 60 * 60;
      authUserId = `dev-user-${challenge.operatorId}`;
    } else if (otpMode === 'local_demo') {
      if (!this.localDemoOtpEnabledForVehicle(challenge.autoNumber)) {
        throw new UnauthorizedException('Demo OTP is no longer enabled');
      }
      if (this.localAutoNumberAuthEnabled() && !this.supabase.isConfigured) {
        throw new ServiceUnavailableException(
          'Local Auto Number testing requires the configured CMS and Admin Supabase registry.',
        );
      }
      if (!this.matchesOtp(otp, DEV_OTP)) {
        throw new UnauthorizedException('Invalid OTP');
      }
      accessToken = `dev.${challenge.operatorId}.${randomUUID()}`;
      expiresIn = 60 * 60;
      authUserId = `dev-user-${challenge.operatorId}`;
    } else {
      if (!challenge.mobileE164) {
        throw new BadRequestException(
          'Registered operator phone number is missing for SMS OTP login',
        );
      }
      const { data, error } = await this.supabase.client.auth.verifyOtp({
        phone: challenge.mobileE164,
        token: otp,
        type: 'sms',
      });
      if (error) {
        const detail = String(error.message ?? '').toLowerCase();
        if (/invalid|expired|token|otp/.test(detail)) {
          throw new UnauthorizedException('Invalid or expired OTP');
        }
        throw new ServiceUnavailableException(
          this.supabaseOtpErrorMessage(error),
        );
      }
      if (!data.session) {
        throw new UnauthorizedException('Invalid or expired OTP');
      }
      accessToken = data.session.access_token;
      refreshToken = data.session.refresh_token;
      expiresIn = data.session.expires_in;
      authUserId = data.session.user.id;

      await this.supabase.client
        .from('cms_operators')
        .update({
          auth_user_id: authUserId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', challenge.operatorId);

      await this.supabase.client
        .from('cms_otp_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challengeId);
    }

    await this.redis.del(this.challengeKey(challengeId));
    await this.redis.del(verifyRateKey);
    await this.redis.del(this.rateLimitKey('demo-invalid', challengeId));

    const operator = await this.findOperatorById(challenge.operatorId);
    const vehicle = await this.findVehicleById(challenge.vehicleId);
    const screen = await this.requireSingleScreenForOperator(
      challenge.operatorId,
      challenge.vehicleId,
    );
    await this.assertRegisteredDisplayDevice(
      challenge.vehicleId,
      screen.id,
      challenge.autoNumber,
    );

    const session: SessionPayload = {
      accessToken,
      refreshToken,
      expiresIn,
      operator: {
        id: challenge.operatorId,
        displayName: operator?.displayName ?? 'Operator',
        roleCode: operator?.roleCode ?? 'cms_operator',
        vehicleId: challenge.vehicleId,
        autoNumber: vehicle?.autoNumber ?? challenge.autoNumber,
      },
      screen,
      screens: [screen],
    };

    await this.redis.set(
      this.sessionKey(accessToken),
      JSON.stringify({
        ...session,
        authUserId,
        sessionValidatedAt: Date.now(),
      }),
      expiresIn ?? SESSION_CACHE_TTL_SEC,
    );

    // Seed the shared demo rotation only for configured local demo auth or the
    // explicitly designated playback vehicles; the queue helper preserves active ads.
    if (
      ((otpMode === 'local_demo' &&
        !this.localAutoNumberAuthEnabled()) ||
        this.isDesignatedDemoPlaybackVehicle(session.operator.autoNumber)) &&
      screen?.id
    ) {
      try {
        await this.queue.ensureDevDemoAdsIfEmpty(screen.id);
      } catch (err) {
        this.logger.warn(
          `Demo queue seed skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (otpMode === 'configured_demo') {
      this.logger.log(
        `Configured demo OTP login succeeded for ${session.operator.autoNumber}`,
      );
    }

    return session;
  }

  private async verifyTemporaryDemoOtp(
    challengeId: string,
    otp: string,
  ): Promise<SessionPayload> {
    const challenge = this.verifyTemporaryDemoToken(
      challengeId,
      TEMP_DEMO_CHALLENGE_PREFIX,
    );
    this.enforceTemporaryDemoRateLimit(
      'demo-verify',
      challenge.jti,
      5,
      CHALLENGE_TTL_SEC,
      'Too many demo verification attempts. Request a new OTP.',
    );
    const expectedOtp = this.temporaryDemoOtp(challenge.autoNumber);
    if (!this.matchesOtp(otp, expectedOtp)) {
      this.logger.warn(
        `Temporary demo OTP verification failed for ${challenge.autoNumber}`,
      );
      throw new UnauthorizedException('Invalid OTP');
    }

    const expiresIn = SESSION_CACHE_TTL_SEC;
    const sessionClaims: TemporaryDemoClaims = {
      ...challenge,
      jti: randomUUID(),
      exp: Math.floor(Date.now() / 1000) + expiresIn,
    };
    const accessToken = this.signTemporaryDemoToken(
      CMS_DEMO_SESSION_PREFIX,
      sessionClaims,
    );
    const session = await this.temporaryDemoSession(
      sessionClaims,
      accessToken,
      expiresIn,
    );
    if (this.isDesignatedDemoPlaybackVehicle(session.operator.autoNumber)) {
      try {
        await this.queue.ensureDevDemoAdsIfEmpty(session.screen.id);
      } catch (err) {
        this.logger.warn(
          `Demo queue seed skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    this.logger.log(
      `Temporary demo OTP login succeeded for ${session.operator.autoNumber}`,
    );
    return session;
  }

  private async resolveTemporaryDemoSession(
    accessToken: string,
  ): Promise<SessionPayload> {
    const claims = this.verifyTemporaryDemoToken(
      accessToken,
      CMS_DEMO_SESSION_PREFIX,
    );
    return this.temporaryDemoSession(
      claims,
      accessToken,
      Math.max(1, claims.exp - Math.floor(Date.now() / 1000)),
    );
  }

  private async temporaryDemoSession(
    claims: TemporaryDemoClaims,
    accessToken: string,
    expiresIn: number,
  ): Promise<SessionPayload> {
    if (!this.supabase.isConfigured) {
      throw new UnauthorizedException('Demo vehicle registry is unavailable');
    }
    if (!this.temporaryDemoAuthEnabled(claims.autoNumber)) {
      throw new UnauthorizedException('Demo vehicle is no longer enabled');
    }
    const vehicle = await this.findVehicle(claims.autoNumber);
    if (
      !vehicle ||
      vehicle.id !== claims.vehicleId ||
      vehicle.status !== 'active' ||
      normalizeAutoNumber(vehicle.autoNumber) !==
        normalizeAutoNumber(claims.autoNumber)
    ) {
      throw new UnauthorizedException('Demo vehicle is no longer active');
    }

    const operator = await this.findOperatorByVehicle(vehicle.id);
    if (!operator || !operator.isActive || operator.id !== claims.operatorId) {
      throw new UnauthorizedException('Demo operator is no longer active');
    }

    const screen = await this.requireSingleScreenForOperator(
      operator.id,
      vehicle.id,
    );
    if (screen.id !== claims.screenId) {
      throw new UnauthorizedException('Demo screen assignment has changed');
    }

    return {
      accessToken,
      expiresIn,
      operator: {
        id: operator.id,
        displayName: operator.displayName,
        roleCode: operator.roleCode,
        vehicleId: vehicle.id,
        autoNumber: vehicle.autoNumber,
      },
      screen,
      screens: [screen],
    };
  }

  async logout(accessToken: string | undefined) {
    if (!accessToken) return { ok: true };
    if (accessToken.startsWith(`${CMS_DEMO_SESSION_PREFIX}.`)) {
      try {
        const session = await this.resolveTemporaryDemoSession(accessToken);
        await this.location.stopForSession(session);
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
      return { ok: true };
    }
    const cached = await this.redis.get(this.sessionKey(accessToken));
    if (cached) {
      try {
        const session = JSON.parse(cached) as SessionPayload;
        if (session?.operator?.vehicleId) {
          await this.location.stopForSession(session);
        }
      } catch {
        /* ignore */
      }
    }
    await this.redis.del(this.sessionKey(accessToken));
    if (!accessToken.startsWith('dev.') && this.supabase.isConfigured) {
      try {
        await this.supabase.client.auth.admin.signOut(accessToken);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  }

  async resolveSession(accessToken: string) {
    if (accessToken.startsWith(`${CMS_DEMO_SESSION_PREFIX}.`)) {
      return this.resolveTemporaryDemoSession(accessToken);
    }

    const cached = await this.redis.get(this.sessionKey(accessToken));
    if (cached) {
      const session = JSON.parse(cached) as SessionPayload & {
        authUserId?: string;
        sessionValidatedAt?: number;
      };
      if (accessToken.startsWith('dev.')) return session;
      if (
        session.sessionValidatedAt &&
        Date.now() - session.sessionValidatedAt < SESSION_REVALIDATE_MS
      ) {
        return session;
      }
      await this.redis.del(this.sessionKey(accessToken));
    }

    if (accessToken.startsWith('dev.')) {
      throw new UnauthorizedException('Session expired');
    }

    if (!this.supabase.isConfigured) {
      throw new UnauthorizedException('Not authenticated');
    }

    const { data, error } =
      await this.supabase.client.auth.getUser(accessToken);
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid session');
    }

    const { data: op } = await this.supabase.client
      .from('cms_operators')
      .select('id, display_name, role_code, vehicle_id, is_active')
      .eq('auth_user_id', data.user.id)
      .maybeSingle();

    if (!op || !op.is_active) {
      throw new UnauthorizedException('Operator not linked');
    }

    const { data: vehicle } = await this.supabase.client
      .from('cms_vehicles')
      .select('auto_number, status')
      .eq('id', op.vehicle_id)
      .maybeSingle();
    const vehicleAutoNumber =
      isRecord(vehicle) && typeof vehicle.auto_number === 'string'
        ? vehicle.auto_number
        : '';
    if (!vehicle || vehicle.status !== 'active' || !vehicleAutoNumber) {
      throw new UnauthorizedException('Vehicle is inactive');
    }

    const screen = await this.requireSingleScreenForOperator(
      op.id,
      op.vehicle_id,
    );
    await this.assertRegisteredDisplayDevice(
      op.vehicle_id,
      screen.id,
      vehicleAutoNumber,
    );
    const session: SessionPayload & {
      authUserId?: string;
      sessionValidatedAt?: number;
    } = {
      accessToken,
      operator: {
        id: op.id,
        displayName: op.display_name,
        roleCode: op.role_code,
        vehicleId: op.vehicle_id,
        autoNumber: vehicleAutoNumber,
      },
      screen,
      screens: [screen],
      authUserId: data.user.id,
      sessionValidatedAt: Date.now(),
    };

    await this.redis.set(
      this.sessionKey(accessToken),
      JSON.stringify(session),
      SESSION_CACHE_TTL_SEC,
    );
    return session;
  }

  private async assertRegisteredDisplayDevice(
    vehicleId: string,
    screenId: string,
    autoNumber?: string,
  ) {
    const localAutoNumberAuth = this.localAutoNumberAuthEnabled();
    const productionRequiresMapping =
      this.config.get<string>('NODE_ENV') === 'production' &&
      this.config.get<string>('VERCEL_ENV') !== 'preview';
    if (
      (!productionRequiresMapping && !localAutoNumberAuth) ||
      !this.supabase.isConfigured
    ) {
      return;
    }

    const linkQuery = this.supabase.client
      .from('vehicle_cms_link')
      .select('admin_device_id, admin_vehicle_id')
      .eq('cms_vehicle_id', vehicleId)
      .eq('cms_screen_id', screenId)
      .eq('status', 'Active');
    const scopedLinkQuery =
      localAutoNumberAuth && autoNumber
        ? linkQuery.eq('auto_number_norm', normalizeAutoNumber(autoNumber))
        : linkQuery;
    const { data: link, error: linkError } =
      await scopedLinkQuery.maybeSingle();
    if (linkError) {
      throw new ServiceUnavailableException(
        `Registered display mapping could not be verified: ${linkError.message}`,
      );
    }
    const adminDeviceId =
      isRecord(link) && typeof link.admin_device_id === 'string'
        ? link.admin_device_id
        : '';
    const adminVehicleId =
      isRecord(link) && typeof link.admin_vehicle_id === 'string'
        ? link.admin_vehicle_id
        : '';
    if (!adminDeviceId || (localAutoNumberAuth && !adminVehicleId)) {
      throw new UnauthorizedException(
        localAutoNumberAuth
          ? 'No active Admin device mapping exists for this Auto Number and screen. Register the vehicle and map its display in Admin.'
          : 'No registered display device is assigned to this screen',
      );
    }

    if (localAutoNumberAuth) {
      const adminVehicleResult: unknown = await this.supabase.client
        .from('admin_vehicles')
        .select('id, payload')
        .eq('id', adminVehicleId)
        .maybeSingle();
      if (!isRecord(adminVehicleResult)) {
        throw new ServiceUnavailableException(
          'Admin vehicle registration could not be verified.',
        );
      }
      const adminVehicleError = isRecord(adminVehicleResult.error)
        ? adminVehicleResult.error
        : null;
      if (adminVehicleError) {
        const detail =
          typeof adminVehicleError.message === 'string'
            ? ` ${adminVehicleError.message}`
            : '';
        throw new ServiceUnavailableException(
          `Admin vehicle registration could not be verified.${detail}`,
        );
      }
      const adminVehicle = isRecord(adminVehicleResult.data)
        ? adminVehicleResult.data
        : null;
      const payload =
        adminVehicle && isRecord(adminVehicle.payload)
          ? adminVehicle.payload
          : null;
      const adminAutoNumber = payload?.no;
      const adminVehicleIsActive =
        typeof payload?.status === 'string' &&
        payload.status.trim().toLowerCase() === 'active';
      if (
        !adminVehicle ||
        !autoNumber ||
        typeof adminAutoNumber !== 'string' ||
        !adminVehicleIsActive ||
        normalizeAutoNumber(adminAutoNumber) !== normalizeAutoNumber(autoNumber)
      ) {
        throw new UnauthorizedException(
          'This Auto Number is not an active Admin vehicle mapped to the CMS screen.',
        );
      }
    }

    let { data: device, error: deviceError } = await this.supabase.client
      .from('admin_dm_devices')
      .select('lifecycle_status, vehicle_id, vehicle_no')
      .eq('id', adminDeviceId)
      .maybeSingle();
    if (!device && !deviceError) {
      const byDeviceId = await this.supabase.client
        .from('admin_dm_devices')
        .select('lifecycle_status, vehicle_id, vehicle_no')
        .eq('device_id', adminDeviceId)
        .maybeSingle();
      device = byDeviceId.data;
      deviceError = byDeviceId.error;
    }
    if (deviceError) {
      throw new ServiceUnavailableException(
        `Registered display status could not be verified: ${deviceError.message}`,
      );
    }
    const deviceLifecycleStatus =
      isRecord(device) && typeof device.lifecycle_status === 'string'
        ? device.lifecycle_status
        : '';
    if (!device || !['active', 'activated'].includes(deviceLifecycleStatus)) {
      throw new UnauthorizedException(
        'Registered display device is revoked or inactive',
      );
    }
    const deviceVehicleId =
      typeof device.vehicle_id === 'string' ? device.vehicle_id : '';
    const deviceAutoNumber =
      typeof device.vehicle_no === 'string' ? device.vehicle_no : '';
    if (
      localAutoNumberAuth &&
      (deviceVehicleId !== adminVehicleId ||
        (deviceAutoNumber &&
          normalizeAutoNumber(deviceAutoNumber) !==
            normalizeAutoNumber(autoNumber ?? '')))
    ) {
      throw new UnauthorizedException(
        'The registered Admin display device is not assigned to this Auto Number.',
      );
    }
  }

  private async startOtp(challenge: OtpChallenge) {
    const otpMode = this.challengeOtpMode(challenge);
    if (otpMode === 'configured_demo') {
      this.configuredAdditionalDemoOtp(challenge.autoNumber);
      return;
    }
    if (otpMode === 'local_demo') {
      if (!this.localDemoOtpEnabledForVehicle(challenge.autoNumber)) {
        throw new UnauthorizedException('Demo OTP is not enabled');
      }
      this.logger.log(`Demo OTP challenge created for ${challenge.autoNumber}`);
      return;
    }
    if (!challenge.mobileE164) {
      throw new BadRequestException(
        'Registered operator phone number is missing for SMS OTP login',
      );
    }
    if (!this.supabase.isConfigured) {
      throw new ServiceUnavailableException(
        'Supabase Auth is not configured on the CMS server. Check SUPABASE_URL and the server-side service key.',
      );
    }

    let response: Awaited<
      ReturnType<typeof this.supabase.client.auth.signInWithOtp>
    >;
    try {
      response = await this.supabase.client.auth.signInWithOtp({
        phone: challenge.mobileE164,
      });
    } catch (error) {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      this.logger.error(
        `Supabase OTP request failed before response (${errorName})`,
      );
      throw new ServiceUnavailableException(
        'Unable to reach Supabase Auth. Check the CMS API network and Supabase project URL.',
      );
    }
    const { error } = response;
    if (error) {
      const message = this.supabaseOtpErrorMessage(error);
      this.logger.error(message);
      throw new ServiceUnavailableException(message);
    }
  }

  private supabaseOtpErrorMessage(error: {
    code?: string;
    status?: number;
    message?: string;
  }) {
    const code = /^[a-z0-9_-]{1,64}$/i.test(String(error.code ?? ''))
      ? String(error.code)
      : '';
    const providerError =
      `${code} ${String(error.message ?? '')}`.toLowerCase();
    let detail =
      'Supabase Auth rejected SMS delivery. Check Authentication → Providers → Phone and the SMS provider logs.';

    if (
      /phone_provider_disabled|provider.*not configured|sms provider.*config/.test(
        providerError,
      )
    ) {
      detail =
        'Configure and enable a Phone SMS provider in Supabase Authentication → Providers → Phone.';
    } else if (
      /rate.?limit|too many|over_sms_send_rate_limit/.test(providerError)
    ) {
      detail =
        'Supabase or the SMS provider rate-limited this request. Wait before retrying and review the Auth rate limits.';
    } else if (
      /invalid.*phone|phone.*invalid|phone.*not valid|not a valid phone|unsupported.*country/.test(
        providerError,
      )
    ) {
      detail =
        'The saved operator phone was rejected. Verify it is a valid +91 Indian mobile number and that the SMS provider supports India.';
    } else if (/sms.*fail|send.*fail|delivery/.test(providerError)) {
      detail =
        'Supabase could not deliver the SMS. Check the SMS provider credentials, sender ID, and delivery logs.';
    }

    const status =
      Number.isInteger(error.status) && Number(error.status) >= 400
        ? ` (HTTP ${error.status}${code ? `, code ${code}` : ''})`
        : code
          ? ` (code ${code})`
          : '';
    return `Unable to send OTP. ${detail}${status}`;
  }

  private async getChallenge(id: string): Promise<OtpChallenge | null> {
    const raw = await this.redis.get(this.challengeKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as OtpChallenge;
  }

  private challengeKey(id: string) {
    return `cms:otp:${id}`;
  }

  private sessionKey(token: string) {
    return `cms:session:${token}`;
  }

  private async findVehicle(autoNumber: string) {
    if (this.supabase.isConfigured) {
      const { data, error } = (await this.supabase.client
        .from('cms_vehicles')
        .select(
          'id, auto_number, registered_mobile, mobile_e164, status, display_name, make_model',
        )
        .ilike('auto_number', autoNumber)
        .maybeSingle()) as {
        data: unknown;
        error: { code?: string } | null;
      };
      if (error) {
        const code = /^[a-z0-9_-]{1,64}$/i.test(String(error.code ?? ''))
          ? ` (${error.code})`
          : '';
        this.logger.error(`CMS vehicle lookup failed${code}`);
        throw new ServiceUnavailableException(
          'CMS vehicle lookup is unavailable. Check the CMS Supabase credentials and migrations.',
        );
      }
      if (!data) return null;
      if (
        !isRecord(data) ||
        typeof data.id !== 'string' ||
        typeof data.auto_number !== 'string' ||
        typeof data.status !== 'string' ||
        typeof data.display_name !== 'string' ||
        typeof data.make_model !== 'string' ||
        !isNullableString(data.registered_mobile) ||
        !isNullableString(data.mobile_e164)
      ) {
        throw new ServiceUnavailableException(
          'The CMS vehicle record is incomplete. Check the vehicle schema and provisioning data.',
        );
      }
      const phone = data.mobile_e164
        ? normalizeIndianPhone(data.mobile_e164)
        : normalizeIndianPhone(data.registered_mobile ?? undefined);
      return {
        id: data.id,
        autoNumber: data.auto_number,
        registeredMobile: phone?.nationalNumber ?? '',
        mobileE164: phone?.mobileE164 ?? '',
        status: data.status,
        displayName: data.display_name,
        makeModel: data.make_model,
      };
    }
    const vercelEnv = this.config.get<string>('VERCEL_ENV');
    const isProduction =
      vercelEnv === 'production' ||
      (this.config.get<string>('NODE_ENV') === 'production' &&
        vercelEnv !== 'preview');
    if (isProduction) {
      throw new ServiceUnavailableException(
        'Production login requires the configured Supabase vehicle registry.',
      );
    }
    const row = DEV_SEED.vehicles.find(
      (v) => normalizeAutoNumber(v.autoNumber) === autoNumber,
    );
    return row
      ? {
          id: row.id,
          autoNumber: row.autoNumber,
          registeredMobile: row.registeredMobile,
          mobileE164: row.mobileE164,
          status: row.status,
          displayName: row.displayName,
          makeModel: row.makeModel,
        }
      : null;
  }

  private async findVehicleById(id: string) {
    if (this.supabase.isConfigured) {
      const { data } = await this.supabase.client
        .from('cms_vehicles')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id as string,
        autoNumber: data.auto_number as string,
        displayName: data.display_name as string,
        makeModel: data.make_model as string,
        status: data.status as string,
      };
    }
    return DEV_SEED.vehicles.find((v) => v.id === id) ?? null;
  }

  private async findOperatorByVehicle(vehicleId: string) {
    if (this.supabase.isConfigured) {
      const { data } = await this.supabase.client
        .from('cms_operators')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id as string,
        displayName: data.display_name as string,
        roleCode: data.role_code as string,
        isActive: data.is_active as boolean,
      };
    }
    const op = DEV_SEED.operators.find((o) => o.vehicleId === vehicleId);
    return op
      ? {
          id: op.id,
          displayName: op.displayName,
          roleCode: op.roleCode,
          isActive: true,
        }
      : null;
  }

  private async findOperatorById(id: string) {
    if (this.supabase.isConfigured) {
      const { data } = await this.supabase.client
        .from('cms_operators')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id as string,
        displayName: data.display_name as string,
        roleCode: data.role_code as string,
      };
    }
    const op = DEV_SEED.operators.find((o) => o.id === id);
    return op
      ? { id: op.id, displayName: op.displayName, roleCode: op.roleCode }
      : null;
  }

  async listScreensForOperator(operatorId: string) {
    if (this.supabase.isConfigured) {
      const { data: assigns } = await this.supabase.client
        .from('cms_screen_assignments')
        .select('screen_id')
        .eq('operator_id', operatorId);
      const ids = (assigns ?? []).map((a) => a.screen_id as string);
      if (!ids.length) return [];
      const { data: screens } = await this.supabase.client
        .from('cms_screens')
        .select('id, code, label, placement')
        .in('id', ids)
        .eq('is_active', true);
      return (screens ?? []).map((s) => ({
        id: s.id as string,
        code: s.code as string,
        label: s.label as string,
        placement: s.placement as string,
      }));
    }
    const screenIds = DEV_SEED.assignments
      .filter((a) => a.operatorId === operatorId)
      .map((a) => a.screenId);
    return DEV_SEED.screens
      .filter((s) => screenIds.includes(s.id) && s.isActive !== false)
      .map((s) => ({
        id: s.id,
        code: s.code,
        label: s.label,
        placement: s.placement,
      }));
  }

  /**
   * Manager rule: exactly one active assigned screen per Auto Number.
   * Never use a client-supplied screen id.
   */
  async requireSingleScreenForOperator(operatorId: string, vehicleId: string) {
    const screens = await this.listScreensForOperator(operatorId);
    const forVehicle = await this.filterScreensForVehicle(screens, vehicleId);
    if (forVehicle.length === 0) {
      throw new BadRequestException(
        'No screen assigned to this Auto Number — cannot open CMS',
      );
    }
    if (forVehicle.length > 1) {
      throw new BadRequestException(
        'Multiple screens for this Auto Number — invalid under one-screen rule',
      );
    }
    return forVehicle[0];
  }

  private async filterScreensForVehicle(
    screens: Array<{
      id: string;
      code: string;
      label: string;
      placement: string;
    }>,
    vehicleId: string,
  ) {
    if (this.supabase.isConfigured) {
      const ids = screens.map((s) => s.id);
      if (!ids.length) return [];
      const { data } = await this.supabase.client
        .from('cms_screens')
        .select('id, code, label, placement, vehicle_id')
        .in('id', ids)
        .eq('vehicle_id', vehicleId)
        .eq('is_active', true);
      return (data ?? []).map((s) => ({
        id: s.id as string,
        code: s.code as string,
        label: s.label as string,
        placement: s.placement as string,
      }));
    }
    const allowed = new Set(screens.map((s) => s.id));
    return DEV_SEED.screens
      .filter(
        (s) =>
          s.vehicleId === vehicleId &&
          s.isActive !== false &&
          allowed.has(s.id),
      )
      .map((s) => ({
        id: s.id,
        code: s.code,
        label: s.label,
        placement: s.placement,
      }));
  }
}

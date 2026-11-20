import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { maskMobile, normalizeAutoNumber } from '../common/mask-mobile';
import { RedisService } from '../redis/redis.service';
import { SupabaseService } from '../supabase/supabase.service';
import { QueueService } from '../queue/queue.service';
import { LocationService } from '../location/location.service';
import { DEV_OTP, DEV_SEED } from './dev-seed';
import type { OtpChallenge, SessionPayload } from './auth.types';

const CHALLENGE_TTL_SEC = 5 * 60;
const SESSION_CACHE_TTL_SEC = 15 * 60;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly redis: RedisService,
    private readonly config: ConfigService,
    @Inject(forwardRef(() => QueueService))
    private readonly queue: QueueService,
    @Inject(forwardRef(() => LocationService))
    private readonly location: LocationService,
  ) {}

  get devAuthEnabled() {
    return (
      this.config.get<string>('CMS_DEV_AUTH') === 'true' ||
      !this.supabase.isConfigured
    );
  }

  async lookupAutoNumber(autoNumberRaw: string) {
    const autoNumber = normalizeAutoNumber(autoNumberRaw);
    const vehicle = await this.findVehicle(autoNumber);
    if (!vehicle) {
      throw new NotFoundException(
        'No registered vehicle found for this Auto Number',
      );
    }
    if (vehicle.status !== 'active') {
      throw new BadRequestException('Vehicle is not active for CMS login');
    }

    const operator = await this.findOperatorByVehicle(vehicle.id);
    if (!operator || !operator.isActive) {
      throw new NotFoundException('No active operator for this vehicle');
    }

    const masked = maskMobile(vehicle.registeredMobile);
    const challengeId = randomUUID();
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SEC * 1000);

    const challenge: OtpChallenge = {
      challengeId,
      vehicleId: vehicle.id,
      operatorId: operator.id,
      autoNumber: vehicle.autoNumber,
      maskedMobile: masked,
      mobileE164: vehicle.mobileE164,
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
    };

    await this.redis.set(
      this.challengeKey(challengeId),
      JSON.stringify(challenge),
      CHALLENGE_TTL_SEC,
    );

    await this.startOtp(challenge);

    if (this.supabase.isConfigured) {
      try {
        await this.supabase.client.from('cms_otp_challenges').insert({
          id: challengeId,
          vehicle_id: vehicle.id,
          masked_mobile: masked,
          supabase_phone: vehicle.mobileE164,
          expires_at: expiresAt.toISOString(),
        });
      } catch (err) {
        this.logger.warn(`otp challenge audit insert skipped: ${String(err)}`);
      }
    }

    return {
      challengeId,
      maskedMobile: masked,
      expiresAt: expiresAt.toISOString(),
      expiresInSec: CHALLENGE_TTL_SEC,
      autoNumber: vehicle.autoNumber,
      devMode: this.devAuthEnabled,
    };
  }

  async resendOtp(challengeId: string) {
    const challenge = await this.getChallenge(challengeId);
    if (!challenge) {
      throw new BadRequestException('OTP challenge expired or invalid');
    }
    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException('OTP challenge expired');
    }
    await this.startOtp(challenge);
    return {
      challengeId,
      maskedMobile: challenge.maskedMobile,
      expiresAt: challenge.expiresAt,
      message: 'OTP resent',
      devMode: this.devAuthEnabled,
    };
  }

  async verifyOtp(challengeId: string, otp: string): Promise<SessionPayload> {
    const challenge = await this.getChallenge(challengeId);
    if (!challenge) {
      throw new BadRequestException('OTP challenge expired or invalid');
    }
    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      await this.redis.del(this.challengeKey(challengeId));
      throw new BadRequestException('OTP expired — request a new code');
    }

    let accessToken: string;
    let refreshToken: string | undefined;
    let expiresIn: number | undefined;
    let authUserId: string | undefined;

    if (this.devAuthEnabled) {
      if (otp !== DEV_OTP) {
        throw new UnauthorizedException('Invalid OTP');
      }
      accessToken = `dev.${challenge.operatorId}.${randomUUID()}`;
      expiresIn = 60 * 60;
      authUserId = `dev-user-${challenge.operatorId}`;
    } else {
      const { data, error } = await this.supabase.client.auth.verifyOtp({
        phone: challenge.mobileE164,
        token: otp,
        type: 'sms',
      });
      if (error || !data.session) {
        throw new UnauthorizedException(error?.message ?? 'Invalid OTP');
      }
      accessToken = data.session.access_token;
      refreshToken = data.session.refresh_token;
      expiresIn = data.session.expires_in;
      authUserId = data.session.user.id;

      await this.supabase.client
        .from('cms_operators')
        .update({ auth_user_id: authUserId, updated_at: new Date().toISOString() })
        .eq('id', challenge.operatorId);

      await this.supabase.client
        .from('cms_otp_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challengeId);
    }

    await this.redis.del(this.challengeKey(challengeId));

    const operator = await this.findOperatorById(challenge.operatorId);
    const vehicle = await this.findVehicleById(challenge.vehicleId);
    const screen = await this.requireSingleScreenForOperator(
      challenge.operatorId,
      challenge.vehicleId,
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
      }),
      expiresIn ?? SESSION_CACHE_TTL_SEC,
    );

    // Local demo: seed PLAYING + QUEUED before display polls dashboard.
    if (this.devAuthEnabled && screen?.id) {
      try {
        await this.queue.ensureDevDemoAdsIfEmpty(screen.id);
      } catch (err) {
        this.logger.warn(
          `Dev demo queue seed skipped: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return session;
  }

  async logout(accessToken: string | undefined) {
    if (!accessToken) return { ok: true };
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
    if (!this.devAuthEnabled && this.supabase.isConfigured) {
      try {
        await this.supabase.client.auth.admin.signOut(accessToken);
      } catch {
        /* ignore */
      }
    }
    return { ok: true };
  }

  async resolveSession(accessToken: string) {
    const cached = await this.redis.get(this.sessionKey(accessToken));
    if (cached) {
      return JSON.parse(cached) as SessionPayload & { authUserId?: string };
    }

    if (accessToken.startsWith('dev.') && this.devAuthEnabled) {
      throw new UnauthorizedException('Session expired');
    }

    if (!this.supabase.isConfigured) {
      throw new UnauthorizedException('Not authenticated');
    }

    const { data, error } = await this.supabase.client.auth.getUser(accessToken);
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
      .select('auto_number')
      .eq('id', op.vehicle_id)
      .maybeSingle();

    const screen = await this.requireSingleScreenForOperator(
      op.id,
      op.vehicle_id,
    );
    const session: SessionPayload & { authUserId?: string } = {
      accessToken,
      operator: {
        id: op.id,
        displayName: op.display_name,
        roleCode: op.role_code,
        vehicleId: op.vehicle_id,
        autoNumber: vehicle?.auto_number ?? '',
      },
      screen,
      screens: [screen],
      authUserId: data.user.id,
    };

    await this.redis.set(
      this.sessionKey(accessToken),
      JSON.stringify(session),
      SESSION_CACHE_TTL_SEC,
    );
    return session;
  }

  private async startOtp(challenge: OtpChallenge) {
    if (this.devAuthEnabled) {
      this.logger.log(
        `DEV OTP for ${challenge.autoNumber} (${challenge.maskedMobile}): ${DEV_OTP}`,
      );
      return;
    }
    const { error } = await this.supabase.client.auth.signInWithOtp({
      phone: challenge.mobileE164,
    });
    if (error) {
      this.logger.error(`Supabase OTP send failed: ${error.message}`);
      throw new BadRequestException(
        'Unable to send OTP — check Supabase Auth phone settings',
      );
    }
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
      const { data, error } = await this.supabase.client
        .from('cms_vehicles')
        .select('*')
        .ilike('auto_number', autoNumber)
        .maybeSingle();
      if (error) {
        this.logger.error(`CMS vehicle lookup failed: ${error.message}`);
        throw new ServiceUnavailableException(
          'CMS vehicle lookup is unavailable. Check the CMS Supabase credentials and migrations.',
        );
      }
      if (!data) return null;
      return {
        id: data.id as string,
        autoNumber: data.auto_number as string,
        registeredMobile: data.registered_mobile as string,
        mobileE164: data.mobile_e164 as string,
        status: data.status as string,
        displayName: data.display_name as string,
        makeModel: data.make_model as string,
      };
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

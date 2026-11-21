import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard';
import type { SessionPayload } from '../auth/auth.types';
import { UpsertLocationDto } from './dto/upsert-location.dto';
import { LocationService } from './location.service';

@Controller('location')
export class LocationController {
  constructor(
    private readonly location: LocationService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @UseGuards(AuthGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  upsert(
    @Req() req: { cmsSession: SessionPayload },
    @Body() dto: UpsertLocationDto,
  ) {
    return this.location.upsertFromSession(req.cmsSession, dto);
  }

  @Post('stop')
  @UseGuards(AuthGuard)
  stop(@Req() req: { cmsSession: SessionPayload }) {
    return this.location.stopForSession(req.cmsSession);
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  mine(@Req() req: { cmsSession: SessionPayload }) {
    return this.location.getMine(req.cmsSession);
  }

  /**
   * Admin live map snapshot. In CMS_DEV_AUTH: open for local Admin HTML.
   * Otherwise requires CMS_INTERNAL_KEY (header x-cms-internal-key or Authorization Bearer).
   */
  @Get('fleet')
  fleet(
    @Headers('x-cms-internal-key') internalKey?: string,
    @Headers('authorization') authorization?: string,
  ) {
    this.assertFleetAccess(internalKey, authorization);
    return this.location.listFleet();
  }

  private assertFleetAccess(internalKey?: string, authorization?: string) {
    const vercelEnv = this.config.get<string>('VERCEL_ENV');
    const isProduction =
      vercelEnv === 'production' ||
      (this.config.get<string>('NODE_ENV') === 'production' &&
        vercelEnv !== 'preview');
    const dev =
      !isProduction &&
      (this.config.get<string>('CMS_DEV_AUTH')?.trim().toLowerCase() ===
        'true' ||
        !this.config.get<string>('SUPABASE_URL') ||
        String(this.config.get<string>('SUPABASE_URL')).includes(
          'YOUR_PROJECT',
        ));
    if (dev) return;

    const expected = this.config.get<string>('CMS_INTERNAL_KEY')?.trim();
    if (!expected) {
      throw new ForbiddenException('Fleet endpoint requires CMS_INTERNAL_KEY');
    }
    const bearer = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (internalKey === expected || bearer === expected) return;
    throw new ForbiddenException('Invalid internal key');
  }
}

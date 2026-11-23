import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '../auth/auth.guard';
import type { SessionPayload } from '../auth/auth.types';
import {
  EnqueueAdsDto,
  PlayerHeartbeatDto,
  PlayerQueueActionDto,
  QueueItemActionDto,
} from './dto/enqueue-ads.dto';
import { QueueService } from './queue.service';

/**
 * MQTT / ad-delivery seam endpoints + session-bound display player ACKs.
 * Internal assign/complete/fail use CMS_INTERNAL_KEY.
 * Player complete/fail use AuthGuard and the session screen id only.
 */
@Controller('queue')
export class QueueController {
  constructor(
    private readonly queue: QueueService,
    private readonly config: ConfigService,
  ) {}

  private assertInternal(key: string | undefined) {
    const expected = this.config.get<string>('CMS_INTERNAL_KEY');
    const vercelEnv = this.config.get<string>('VERCEL_ENV');
    const isProduction =
      vercelEnv === 'production' ||
      (this.config.get<string>('NODE_ENV') === 'production' &&
        vercelEnv !== 'preview');
    if (!expected) {
      if (
        !isProduction &&
        this.config.get<string>('CMS_DEV_AUTH')?.trim().toLowerCase() === 'true'
      ) {
        return;
      }
      throw new UnauthorizedException('CMS_INTERNAL_KEY not configured');
    }
    if (!key || key !== expected) {
      throw new UnauthorizedException('Invalid internal key');
    }
  }

  @Post('assign')
  assign(
    @Headers('x-cms-internal-key') key: string | undefined,
    @Body() body: EnqueueAdsDto,
  ) {
    this.assertInternal(key);
    return this.queue.enqueue(body.screenId, body.ads, {
      vehicleId: body.vehicleId,
    });
  }

  @Post('complete')
  complete(
    @Headers('x-cms-internal-key') key: string | undefined,
    @Body() body: QueueItemActionDto,
  ) {
    this.assertInternal(key);
    return this.queue.completePlaying(body.screenId, body.queueItemId);
  }

  @Post('fail')
  fail(
    @Headers('x-cms-internal-key') key: string | undefined,
    @Body() body: QueueItemActionDto,
  ) {
    this.assertInternal(key);
    return this.queue.failPlaying(body.screenId, body.queueItemId, body.reason);
  }

  @Post('cancel')
  cancel(
    @Headers('x-cms-internal-key') key: string | undefined,
    @Body() body: QueueItemActionDto,
  ) {
    this.assertInternal(key);
    return this.queue.cancelQueued(body.screenId, body.queueItemId);
  }

  /**
   * Display PWA: video ended / image dwell finished → complete + promote next.
   * Screen id is taken from the OTP session (never trust client screenId).
   */
  @Post('player/complete')
  @UseGuards(AuthGuard)
  playerComplete(
    @Req() req: { cmsSession: SessionPayload },
    @Body() body: PlayerQueueActionDto,
  ) {
    return this.queue.completePlaying(
      req.cmsSession.screen.id,
      body.queueItemId,
      body.occurredAt,
    );
  }

  /**
   * Display PWA: missing/expired/broken mediaUrl → fail + promote next (or idle).
   */
  @Post('player/fail')
  @UseGuards(AuthGuard)
  playerFail(
    @Req() req: { cmsSession: SessionPayload },
    @Body() body: PlayerQueueActionDto,
  ) {
    return this.queue.failPlaying(
      req.cmsSession.screen.id,
      body.queueItemId,
      body.reason,
      body.occurredAt,
    );
  }

  @Post('player/start')
  @UseGuards(AuthGuard)
  playerStart(
    @Req() req: { cmsSession: SessionPayload },
    @Body() body: PlayerQueueActionDto,
  ) {
    return this.queue.startPlaying(
      req.cmsSession.screen.id,
      body.queueItemId,
      body.occurredAt,
    );
  }

  @Post('player/heartbeat')
  @UseGuards(AuthGuard)
  playerHeartbeat(
    @Req() req: { cmsSession: SessionPayload },
    @Body() body: PlayerHeartbeatDto,
  ) {
    return this.queue.recordPlayerHeartbeat(req.cmsSession.screen.id, body);
  }

  /** Operator-facing read is via dashboard; this is a guarded debug peek. */
  @Post('snapshot')
  @UseGuards(AuthGuard)
  snapshot(
    @Req() req: { cmsSession: SessionPayload },
    @Body() body: { screenId: string },
  ) {
    if (body.screenId !== req.cmsSession.screen.id) {
      throw new ForbiddenException('Screen is not assigned to this session');
    }
    return this.queue.snapshot(body.screenId);
  }
}

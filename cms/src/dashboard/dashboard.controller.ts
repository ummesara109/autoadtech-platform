import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { SessionPayload } from '../auth/auth.types';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** Preferred: session-bound dashboard (no client screen id). */
  @Get()
  getMine(@Req() req: { cmsSession: SessionPayload }) {
    return this.dashboard.getDashboard(req.cmsSession);
  }

  /**
   * Legacy path — UUID must match the session’s single screen.
   * Cross-auto URL tampering → 403.
   */
  @Get(':screenId')
  getByParam(
    @Param('screenId', new ParseUUIDPipe({ version: '4' })) screenId: string,
    @Req() req: { cmsSession: SessionPayload },
  ) {
    return this.dashboard.getDashboard(req.cmsSession, screenId);
  }
}

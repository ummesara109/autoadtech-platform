import { Controller, Get, GoneException, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import type { SessionPayload } from '../auth/auth.types';

/**
 * Screen picker removed (manager rule: one screen per Auto Number).
 * Kept endpoint returns 410 so old clients fail loudly.
 */
@Controller('screens')
@UseGuards(AuthGuard)
export class ScreensController {
  @Get()
  list(@Req() req: { cmsSession: SessionPayload }) {
    throw new GoneException({
      message:
        'Screen selection removed — each Auto Number has exactly one screen. Use GET /api/dashboard.',
      screen: req.cmsSession.screen,
      operator: req.cmsSession.operator,
    });
  }
}

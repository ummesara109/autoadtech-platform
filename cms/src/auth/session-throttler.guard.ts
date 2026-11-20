import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'crypto';

@Injectable()
export class SessionThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const headers = req.headers as
      Record<string, string | undefined> | undefined;
    const authorization = headers?.authorization ?? headers?.Authorization;
    const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
    if (match) {
      return `session:${createHash('sha256').update(match[1]).digest('hex')}`;
    }
    return super.getTracker(req);
  }
}

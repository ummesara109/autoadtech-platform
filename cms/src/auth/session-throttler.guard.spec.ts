import { Reflector } from '@nestjs/core';
import type { ThrottlerStorage } from '@nestjs/throttler';
import { SessionThrottlerGuard } from './session-throttler.guard';

class TestableSessionThrottlerGuard extends SessionThrottlerGuard {
  tracker(req: Record<string, any>) {
    return this.getTracker(req);
  }
}

describe('SessionThrottlerGuard', () => {
  const storage: ThrottlerStorage = {
    increment: () =>
      Promise.resolve({
        totalHits: 0,
        timeToExpire: 0,
        isBlocked: false,
        timeToBlockExpire: 0,
      }),
  };
  const guard = new TestableSessionThrottlerGuard([], storage, new Reflector());

  it('uses a stable opaque tracker for each authenticated session', async () => {
    const first = await guard.tracker({
      headers: { authorization: 'Bearer session-one' },
      ip: '172.20.0.2',
    });
    const same = await guard.tracker({
      headers: { authorization: 'bearer session-one' },
      ip: '172.20.0.2',
    });
    const other = await guard.tracker({
      headers: { authorization: 'Bearer session-two' },
      ip: '172.20.0.2',
    });

    expect(first).toBe(same);
    expect(first).not.toContain('session-one');
    expect(first).not.toBe(other);
  });

  it('retains the request IP tracker when no bearer session is present', async () => {
    await expect(
      guard.tracker({ headers: {}, ip: '203.0.113.12' }),
    ).resolves.toBe('203.0.113.12');
  });
});

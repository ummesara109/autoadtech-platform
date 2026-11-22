import { ExecutionContext } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import {
  CMS_DEMO_SESSION_COOKIE,
  CMS_DEMO_SESSION_PREFIX,
} from './auth.constants';

describe('AuthGuard', () => {
  it('resolves a signed demo session from the HttpOnly cookie', async () => {
    const token = `${CMS_DEMO_SESSION_PREFIX}.signed-value`;
    const resolveSession = jest
      .fn()
      .mockResolvedValue({ operator: { id: 'op-1' } });
    const auth = {
      resolveSession,
    } as unknown as AuthService;
    const request = {
      headers: { cookie: `${CMS_DEMO_SESSION_COOKIE}=${token}` },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new AuthGuard(auth);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(resolveSession).toHaveBeenCalledWith(token);
    expect(request).toHaveProperty('cmsSession');
  });

  it('continues to resolve existing bearer sessions', async () => {
    const token = 'existing-supabase-session';
    const resolveSession = jest
      .fn()
      .mockResolvedValue({ operator: { id: 'op-1' } });
    const auth = {
      resolveSession,
    } as unknown as AuthService;
    const request = { headers: { authorization: `Bearer ${token}` } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new AuthGuard(auth);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(resolveSession).toHaveBeenCalledWith(token);
  });
});

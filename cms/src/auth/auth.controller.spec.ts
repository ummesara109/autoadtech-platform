import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CMS_DEMO_SESSION_COOKIE } from './auth.constants';

describe('AuthController demo session cookie', () => {
  const demoToken = 'cms-demo-session.signed-value';
  const session = {
    accessToken: demoToken,
    expiresIn: 900,
    operator: {
      id: 'operator-1',
      displayName: 'Demo operator',
      roleCode: 'driver',
      vehicleId: 'vehicle-1',
      autoNumber: 'KA01AB0000',
    },
    screen: {
      id: 'screen-1',
      code: 'screen-1',
      label: 'Vehicle display',
      placement: 'rear',
    },
    screens: [
      {
        id: 'screen-1',
        code: 'screen-1',
        label: 'Vehicle display',
        placement: 'rear',
      },
    ],
  };

  it('sets an HttpOnly Secure cookie and omits the demo session token from JSON', async () => {
    const auth = {
      verifyOtp: jest.fn().mockResolvedValue(session),
    } as unknown as AuthService;
    const controller = new AuthController(auth);
    const response = { header: jest.fn() };
    const result = await controller.verify(
      { challengeId: 'challenge', otp: '123456' },
      {
        headers: { 'x-forwarded-proto': 'https' },
        protocol: 'http',
      },
      response,
    );

    expect(response.header).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining(
        `${CMS_DEMO_SESSION_COOKIE}=${demoToken}; Path=/api; Max-Age=900; HttpOnly; SameSite=Strict; Secure`,
      ),
    );
    expect(result).toEqual({
      expiresIn: 900,
      operator: session.operator,
      screen: session.screen,
      screens: session.screens,
      sessionMode: 'demo-cookie',
    });
    expect(result).not.toHaveProperty('accessToken');
  });

  it('keeps real Supabase sessions in the existing bearer response', async () => {
    const realSession = { ...session, accessToken: 'supabase-access-token' };
    const auth = {
      verifyOtp: jest.fn().mockResolvedValue(realSession),
    } as unknown as AuthService;
    const controller = new AuthController(auth);
    const response = { header: jest.fn() };

    const result = await controller.verify(
      { challengeId: 'challenge', otp: '654321' },
      { headers: {} },
      response,
    );

    expect(result).toEqual(realSession);
    expect(response.header).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining(
        `${CMS_DEMO_SESSION_COOKIE}=; Path=/api; Max-Age=0`,
      ),
    );
  });

  it('clears the demo cookie on logout and uses its signed token', async () => {
    const logout = jest.fn().mockResolvedValue({ ok: true });
    const auth = {
      logout,
    } as unknown as AuthService;
    const controller = new AuthController(auth);
    const response = { header: jest.fn() };

    await controller.logout(
      undefined,
      { headers: { cookie: `${CMS_DEMO_SESSION_COOKIE}=${demoToken}` } },
      response,
    );

    expect(logout).toHaveBeenCalledWith(demoToken);
    expect(response.header).toHaveBeenCalledWith(
      'Set-Cookie',
      expect.stringContaining(
        `${CMS_DEMO_SESSION_COOKIE}=; Path=/api; Max-Age=0`,
      ),
    );
  });
});

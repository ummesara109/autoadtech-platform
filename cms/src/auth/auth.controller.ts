import {
  Body,
  Controller,
  Headers,
  InternalServerErrorException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  CMS_DEMO_SESSION_COOKIE,
  CMS_DEMO_SESSION_PREFIX,
} from './auth.constants';
import { LookupAutoNumberDto } from './dto/lookup-auto-number.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

type AuthRequest = {
  headers: Record<string, string | string[] | undefined>;
  protocol?: string;
};

type CookieResponse = {
  header?: (name: string, value: string) => unknown;
  setHeader?: (name: string, value: string) => unknown;
  raw?: { setHeader: (name: string, value: string) => unknown };
};

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('lookup')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  lookup(@Body() dto: LookupAutoNumberDto) {
    return this.auth.lookupAutoNumber(dto.autoNumber);
  }

  @Post('verify-otp')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async verify(
    @Body() dto: VerifyOtpDto,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const session = await this.auth.verifyOtp(dto.challengeId, dto.otp);
    if (!session.accessToken.startsWith(`${CMS_DEMO_SESSION_PREFIX}.`)) {
      this.clearDemoSessionCookie(request, response);
      return session;
    }

    const maxAge = Math.max(1, Math.floor(session.expiresIn ?? 15 * 60));
    this.writeCookie(
      response,
      `${CMS_DEMO_SESSION_COOKIE}=${session.accessToken}; Path=/api; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${this.isSecureRequest(request) ? '; Secure' : ''}`,
    );

    return {
      expiresIn: session.expiresIn,
      operator: session.operator,
      screen: session.screen,
      screens: session.screens,
      sessionMode: 'demo-cookie' as const,
    };
  }

  @Post('resend-otp')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resend(@Body() dto: ResendOtpDto) {
    return this.auth.resendOtp(dto.challengeId);
  }

  @Post('logout')
  async logout(
    @Headers('authorization') authorization: string | undefined,
    @Req() request: AuthRequest,
    @Res({ passthrough: true }) response: CookieResponse,
  ) {
    const bearerToken = authorization?.replace(/^Bearer\s+/i, '').trim();
    const cookieToken = this.demoSessionToken(request);
    const result = await this.auth.logout(bearerToken || cookieToken);
    this.clearDemoSessionCookie(request, response);
    return result;
  }

  private demoSessionToken(request: AuthRequest): string | undefined {
    const header = request.headers.cookie;
    const cookies = Array.isArray(header) ? header.join(';') : header;
    const token = cookies
      ?.split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${CMS_DEMO_SESSION_COOKIE}=`))
      ?.slice(CMS_DEMO_SESSION_COOKIE.length + 1);
    return token?.startsWith(`${CMS_DEMO_SESSION_PREFIX}.`) ? token : undefined;
  }

  private clearDemoSessionCookie(
    request: AuthRequest,
    response: CookieResponse,
  ) {
    const secure = this.isSecureRequest(request) ? '; Secure' : '';
    this.writeCookie(
      response,
      `${CMS_DEMO_SESSION_COOKIE}=; Path=/api; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Strict${secure}`,
    );
  }

  private isSecureRequest(request: AuthRequest): boolean {
    const forwardedProto = request.headers['x-forwarded-proto'];
    const protocol = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto;
    return (
      process.env.NODE_ENV === 'production' ||
      protocol?.split(',')[0].trim() === 'https' ||
      request.protocol === 'https'
    );
  }

  private writeCookie(response: CookieResponse, cookie: string) {
    if (response.header) {
      response.header('Set-Cookie', cookie);
      return;
    }
    if (response.setHeader) {
      response.setHeader('Set-Cookie', cookie);
      return;
    }
    if (response.raw?.setHeader) {
      response.raw.setHeader('Set-Cookie', cookie);
      return;
    }
    throw new InternalServerErrorException(
      'Unable to configure the CMS demo session cookie',
    );
  }
}

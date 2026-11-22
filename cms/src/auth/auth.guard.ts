import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import {
  CMS_DEMO_SESSION_COOKIE,
  CMS_DEMO_SESSION_PREFIX,
} from './auth.constants';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      cmsSession?: unknown;
    }>();
    const header = req.headers['authorization'] ?? req.headers['Authorization'];
    const bearerToken =
      typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7).trim()
        : undefined;
    const cookieHeader = req.headers.cookie;
    const cookieString = Array.isArray(cookieHeader)
      ? cookieHeader.join(';')
      : cookieHeader;
    const demoCookieToken = cookieString
      ?.split(';')
      .map((entry) => entry.trim())
      .find((entry) => entry.startsWith(`${CMS_DEMO_SESSION_COOKIE}=`))
      ?.slice(CMS_DEMO_SESSION_COOKIE.length + 1);
    const token =
      bearerToken ||
      (demoCookieToken?.startsWith(`${CMS_DEMO_SESSION_PREFIX}.`)
        ? demoCookieToken
        : undefined);
    if (!token) throw new UnauthorizedException('Missing session');
    req.cmsSession = await this.auth.resolveSession(token);
    return true;
  }
}

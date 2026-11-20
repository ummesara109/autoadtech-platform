import { Body, Controller, Headers, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LookupAutoNumberDto } from './dto/lookup-auto-number.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

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
  verify(@Body() dto: VerifyOtpDto) {
    return this.auth.verifyOtp(dto.challengeId, dto.otp);
  }

  @Post('resend-otp')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  resend(@Body() dto: ResendOtpDto) {
    return this.auth.resendOtp(dto.challengeId);
  }

  @Post('logout')
  logout(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    return this.auth.logout(token);
  }
}

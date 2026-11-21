import { IsString, MaxLength, Matches, MinLength } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @MinLength(36)
  @MaxLength(1024)
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/, { message: 'otp must be exactly 6 digits' })
  otp!: string;
}

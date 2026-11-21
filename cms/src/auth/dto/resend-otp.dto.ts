import { IsString, MaxLength, MinLength } from 'class-validator';

export class ResendOtpDto {
  @IsString()
  @MinLength(36)
  @MaxLength(1024)
  challengeId!: string;
}

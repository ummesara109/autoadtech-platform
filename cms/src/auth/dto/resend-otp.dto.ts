import { IsString, Length } from 'class-validator';

export class ResendOtpDto {
  @IsString()
  @Length(36, 64)
  challengeId!: string;
}

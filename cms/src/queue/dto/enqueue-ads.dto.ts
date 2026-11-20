import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class AdDto {
  @IsString()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  advertiser?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  durationSec?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  externalAdId?: string;

  /** Optional https creative URL for the Auto Display PWA. */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  mediaUrl?: string;
}

export class EnqueueAdsDto {
  @IsUUID('4')
  screenId!: string;

  @IsOptional()
  @IsUUID('4')
  vehicleId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdDto)
  ads!: AdDto[];
}

export class QueueItemActionDto {
  @IsUUID('4')
  screenId!: string;

  @IsUUID('4')
  queueItemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Display player ACK — screen comes from the session, not the body. */
export class PlayerQueueActionDto {
  @IsUUID('4')
  queueItemId!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

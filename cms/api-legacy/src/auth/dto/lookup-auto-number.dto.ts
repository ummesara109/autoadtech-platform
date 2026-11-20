import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class LookupAutoNumberDto {
  @IsString()
  @MinLength(4)
  @MaxLength(20)
  @Matches(/^[A-Za-z0-9\s-]+$/, {
    message: 'autoNumber must be alphanumeric (spaces/hyphens allowed)',
  })
  autoNumber!: string;
}

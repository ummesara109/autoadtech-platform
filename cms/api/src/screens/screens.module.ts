import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ScreensController } from './screens.controller';

@Module({
  imports: [AuthModule],
  controllers: [ScreensController],
})
export class ScreensModule {}

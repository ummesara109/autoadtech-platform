import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { LocationModule } from '../location/location.module';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [AuthModule, QueueModule, LocationModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}

import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QueueModule } from '../queue/queue.module';
import { AdminGpsClient } from './admin-gps.client';
import { LocationController } from './location.controller';
import { LocationService } from './location.service';
import { LocationStore } from './location.store';

@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => QueueModule)],
  controllers: [LocationController],
  providers: [LocationStore, LocationService, AdminGpsClient],
  exports: [LocationService, LocationStore],
})
export class LocationModule {}

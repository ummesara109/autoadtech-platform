import { Module, forwardRef } from '@nestjs/common';
import { QueueModule } from '../queue/queue.module';
import { LocationModule } from '../location/location.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';

@Module({
  imports: [forwardRef(() => QueueModule), forwardRef(() => LocationModule)],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard],
})
export class AuthModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { SessionThrottlerGuard } from './auth/session-throttler.guard';
import { AuthModule } from './auth/auth.module';
import { ScreensModule } from './screens/screens.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { QueueModule } from './queue/queue.module';
import { LocationModule } from './location/location.module';
import { HealthController } from './health.controller';
import { RedisModule } from './redis/redis.module';
import { SupabaseModule } from './supabase/supabase.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    RedisModule,
    SupabaseModule,
    AuthModule,
    ScreensModule,
    QueueModule,
    DashboardModule,
    LocationModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: SessionThrottlerGuard }],
})
export class AppModule {}

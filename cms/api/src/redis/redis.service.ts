import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private memory = new Map<string, { value: string; expiresAt?: number }>();
  private usingMemory = false;

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.usingMemory = true;
      this.logger.warn('REDIS_URL unset — using in-memory cache fallback');
      return;
    }
    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 1,
        lazyConnect: true,
      });
      void this.client.connect().catch((err: Error) => {
        this.logger.warn(
          `Redis connect failed (${err.message}); falling back to memory`,
        );
        this.usingMemory = true;
        this.client = null;
      });
    } catch (err) {
      this.usingMemory = true;
      this.logger.warn(`Redis init failed; memory fallback: ${String(err)}`);
    }
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit();
  }

  get isMemoryFallback() {
    return this.usingMemory || !this.client;
  }

  async get(key: string): Promise<string | null> {
    if (this.isMemoryFallback) {
      const row = this.memory.get(key);
      if (!row) return null;
      if (row.expiresAt && Date.now() > row.expiresAt) {
        this.memory.delete(key);
        return null;
      }
      return row.value;
    }
    return this.client!.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.isMemoryFallback) {
      this.memory.set(key, {
        value,
        expiresAt: ttlSeconds
          ? Date.now() + ttlSeconds * 1000
          : undefined,
      });
      return;
    }
    if (ttlSeconds) {
      await this.client!.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.client!.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    if (this.isMemoryFallback) {
      this.memory.delete(key);
      return;
    }
    await this.client!.del(key);
  }
}

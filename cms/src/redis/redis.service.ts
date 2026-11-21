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

  async onModuleInit() {
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
        connectTimeout: 5_000,
        retryStrategy: () => null,
      });
      await this.client.connect();
      this.usingMemory = false;
    } catch (err) {
      const errorName = err instanceof Error ? err.name : 'UnknownError';
      this.logger.warn(`Redis connection failed (${errorName}); using memory`);
      this.usingMemory = true;
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit();
  }

  get isMemoryFallback() {
    return this.usingMemory || !this.client;
  }

  get isAvailable() {
    return this.client?.status === 'ready';
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
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : undefined,
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

  async incrementWithTtl(key: string, ttlSeconds: number): Promise<number> {
    if (this.isMemoryFallback) {
      const current = Number(await this.get(key)) || 0;
      const next = current + 1;
      await this.set(key, String(next), ttlSeconds);
      return next;
    }

    const result = await this.client!.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count",
      1,
      key,
      String(ttlSeconds),
    );
    return Number(result);
  }
}

import { REDIS_KEY_PREFIX, redisClient } from '@root/redis-client';

import { logger } from './logger';

interface CacheConfig {
  ttl?: number; // TTL in seconds, default 1 hour
  logPrefix?: string; // Prefix for log messages
  parseJson?: boolean; // Whether to parse JSON or return raw strings
}

export class CacheClient<T = unknown> {
  private readonly ttl: number;
  private readonly logPrefix: string;
  private readonly parseJson: boolean;

  constructor(config: CacheConfig = {}) {
    this.ttl = config.ttl ?? 3600;
    this.logPrefix = config.logPrefix ?? 'Cache';
    this.parseJson = config.parseJson ?? true;
  }

  async read(key: string): Promise<T | null> {
    try {
      const cached = await redisClient.get(key);
      if (cached !== null) {
        return this.parseJson ? JSON.parse(cached) : (cached as T);
      } else {
        return null;
      }
    } catch (error) {
      logger.error({ message: `${this.logPrefix} read error for key ${key}:`, error: error as Error });
      return null;
    }
  }

  async write(params: { key: string; value: T; ttl?: number }): Promise<void> {
    const ttl = params.ttl ?? this.ttl;

    try {
      const serializedValue = typeof params.value === 'string' ? params.value : JSON.stringify(params.value);
      await redisClient.setex(params.key, ttl, serializedValue);
    } catch (error) {
      logger.error({ message: `${this.logPrefix} write error for key ${params.key}:`, error: error as Error });
    }
  }

  async delete(keyOrPattern: string, isPattern = false): Promise<void> {
    try {
      if (isPattern) {
        // ioredis applies `keyPrefix` to key arguments but not to the KEYS pattern, so the pattern
        // carries the prefix itself; otherwise a prefixed client matches nothing.
        const keys = await redisClient.keys(`${REDIS_KEY_PREFIX ?? ''}${keyOrPattern}`);
        if (keys.length > 0) {
          // Strip keyPrefix from keys returned by keys() to avoid double-prefixing
          const strippedKeys = REDIS_KEY_PREFIX ? keys.map((k) => k.slice(REDIS_KEY_PREFIX!.length)) : keys;
          await redisClient.del(...strippedKeys);
        }
      } else {
        await redisClient.del(keyOrPattern);
      }
    } catch (error) {
      logger.error({ message: `${this.logPrefix} delete error for ${keyOrPattern}:`, error: error as Error });
    }
  }

  async readBatch(keys: string[]): Promise<Map<string, T | null>> {
    const results = new Map<string, T | null>();

    try {
      const cachedResults = await redisClient.mget(...keys);

      keys.forEach((key, index) => {
        const cached = cachedResults[index];
        if (cached !== null && cached !== undefined) {
          const parsedValue = this.parseJson ? JSON.parse(cached) : (cached as T);
          results.set(key, parsedValue);
        } else {
          results.set(key, null);
        }
      });
    } catch (error) {
      console.warn(`${this.logPrefix} batch read error:`, error);
      keys.forEach((key) => results.set(key, null));
    }

    return results;
  }
}

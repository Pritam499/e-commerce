import { createClient, RedisClientType } from 'redis';
import { logger } from '../../utils/logger';

export interface CacheOptions {
  ttl?: number; // Time to live in seconds
  prefix?: string; // Key prefix
}

export class RedisCacheService {
  private client: RedisClientType;
  private isConnected = false;
  private defaultTTL = 30 * 24 * 60 * 60; // 30 days in seconds
  private keyPrefixes = {
    CART_SESSION: 'cart:session:',
    CART_RECOVERY: 'cart:recovery:',
    USER_SESSIONS: 'user:sessions:',
    CACHE: 'cache:',
  };

  constructor() {
    this.client = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      socket: {
        connectTimeout: 60000,
      },
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          logger.error('Redis connection refused');
          return new Error('Redis connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          logger.error('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
          logger.error('Redis max retry attempts reached');
          return undefined;
        }
        // Exponential backoff
        return Math.min(options.attempt * 100, 3000);
      }
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('🔗 Redis connected');
      this.isConnected = true;
    });

    this.client.on('ready', () => {
      logger.info('✅ Redis ready');
    });

    this.client.on('error', (error) => {
      logger.error('❌ Redis error:', error);
      this.isConnected = false;
    });

    this.client.on('end', () => {
      logger.info('🔌 Redis connection ended');
      this.isConnected = false;
    });
  }

  async connect(): Promise<void> {
    if (!this.isConnected) {
      try {
        await this.client.connect();
      } catch (error) {
        logger.error('Failed to connect to Redis:', error);
        throw error;
      }
    }
  }

  async disconnect(): Promise<void> {
    if (this.isConnected) {
      await this.client.disconnect();
    }
  }

  // Generic cache operations
  async set(key: string, value: any, options: CacheOptions = {}): Promise<void> {
    const fullKey = this.getFullKey(key, options.prefix);
    const serializedValue = JSON.stringify(value);
    const ttl = options.ttl || this.defaultTTL;

    try {
      await this.client.setEx(fullKey, ttl, serializedValue);
    } catch (error) {
      logger.error(`Failed to set cache key ${fullKey}:`, error);
      throw error;
    }
  }

  async get<T = any>(key: string, prefix?: string): Promise<T | null> {
    const fullKey = this.getFullKey(key, prefix);

    try {
      const value = await this.client.get(fullKey);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      logger.error(`Failed to get cache key ${fullKey}:`, error);
      return null;
    }
  }

  async delete(key: string, prefix?: string): Promise<boolean> {
    const fullKey = this.getFullKey(key, prefix);

    try {
      const result = await this.client.del(fullKey);
      return result > 0;
    } catch (error) {
      logger.error(`Failed to delete cache key ${fullKey}:`, error);
      return false;
    }
  }

  async exists(key: string, prefix?: string): Promise<boolean> {
    const fullKey = this.getFullKey(key, prefix);

    try {
      const result = await this.client.exists(fullKey);
      return result > 0;
    } catch (error) {
      logger.error(`Failed to check existence of cache key ${fullKey}:`, error);
      return false;
    }
  }

  async expire(key: string, ttl: number, prefix?: string): Promise<boolean> {
    const fullKey = this.getFullKey(key, prefix);

    try {
      const result = await this.client.expire(fullKey, ttl);
      return result > 0;
    } catch (error) {
      logger.error(`Failed to set expiry for cache key ${fullKey}:`, error);
      return false;
    }
  }

  async ttl(key: string, prefix?: string): Promise<number> {
    const fullKey = this.getFullKey(key, prefix);

    try {
      return await this.client.ttl(fullKey);
    } catch (error) {
      logger.error(`Failed to get TTL for cache key ${fullKey}:`, error);
      return -1;
    }
  }

  // Batch operations
  async mset(keyValuePairs: Array<{ key: string; value: any; ttl?: number; prefix?: string }>): Promise<void> {
    try {
      const pipeline = this.client.multi();

      for (const { key, value, ttl, prefix } of keyValuePairs) {
        const fullKey = this.getFullKey(key, prefix);
        const serializedValue = JSON.stringify(value);
        const expiry = ttl || this.defaultTTL;
        pipeline.setEx(fullKey, expiry, serializedValue);
      }

      await pipeline.exec();
    } catch (error) {
      logger.error('Failed to execute batch set operation:', error);
      throw error;
    }
  }

  async mget<T = any>(keys: Array<{ key: string; prefix?: string }>): Promise<(T | null)[]> {
    try {
      const fullKeys = keys.map(({ key, prefix }) => this.getFullKey(key, prefix));
      const values = await this.client.mGet(fullKeys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      logger.error('Failed to execute batch get operation:', error);
      throw error;
    }
  }

  // Pattern-based operations
  async keys(pattern: string, prefix?: string): Promise<string[]> {
    const fullPattern = this.getFullKey(pattern, prefix);

    try {
      return await this.client.keys(fullPattern);
    } catch (error) {
      logger.error(`Failed to get keys with pattern ${fullPattern}:`, error);
      return [];
    }
  }

  async deletePattern(pattern: string, prefix?: string): Promise<number> {
    try {
      const keys = await this.keys(pattern, prefix);
      if (keys.length === 0) return 0;

      const result = await this.client.del(keys);
      return result;
    } catch (error) {
      logger.error(`Failed to delete keys with pattern ${pattern}:`, error);
      return 0;
    }
  }

  // Cart-specific operations
  async setCartSession(customerId: string, cartData: any, ttl?: number): Promise<void> {
    await this.set(customerId, cartData, {
      prefix: this.keyPrefixes.CART_SESSION,
      ttl: ttl || this.defaultTTL
    });
  }

  async getCartSession(customerId: string): Promise<any | null> {
    return await this.get(customerId, this.keyPrefixes.CART_SESSION);
  }

  async deleteCartSession(customerId: string): Promise<boolean> {
    return await this.delete(customerId, this.keyPrefixes.CART_SESSION);
  }

  async setCartRecovery(recoveryToken: string, recoveryData: any, ttl?: number): Promise<void> {
    await this.set(recoveryToken, recoveryData, {
      prefix: this.keyPrefixes.CART_RECOVERY,
      ttl: ttl || 7 * 24 * 60 * 60 // 7 days
    });
  }

  async getCartRecovery(recoveryToken: string): Promise<any | null> {
    return await this.get(recoveryToken, this.keyPrefixes.CART_RECOVERY);
  }

  async deleteCartRecovery(recoveryToken: string): Promise<boolean> {
    return await this.delete(recoveryToken, this.keyPrefixes.CART_RECOVERY);
  }

  // Statistics and monitoring
  async getStats(): Promise<{
    connected: boolean;
    keys: { [prefix: string]: number };
    info: any;
  }> {
    try {
      const info = await this.client.info();

      // Count keys for each prefix
      const keyCounts: { [prefix: string]: number } = {};
      for (const [name, prefix] of Object.entries(this.keyPrefixes)) {
        const keys = await this.keys('*', prefix);
        keyCounts[name.toLowerCase()] = keys.length;
      }

      return {
        connected: this.isConnected,
        keys: keyCounts,
        info: this.parseRedisInfo(info)
      };
    } catch (error) {
      logger.error('Failed to get Redis stats:', error);
      return {
        connected: false,
        keys: {},
        info: null
      };
    }
  }

  private parseRedisInfo(info: string): any {
    const lines = info.split('\r\n');
    const parsed: any = {};

    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        parsed[key] = value;
      }
    }

    return parsed;
  }

  private getFullKey(key: string, prefix?: string): string {
    if (prefix) {
      return `${prefix}${key}`;
    }
    return key;
  }

  // Health check
  async ping(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }

  // Cleanup expired keys (Redis does this automatically)
  async cleanup(): Promise<void> {
    try {
      // Redis automatically expires keys, so manual cleanup is not needed
      // This method can be used for monitoring or maintenance
      logger.info('Redis cleanup completed (automatic expiration)');
    } catch (error) {
      logger.error('Redis cleanup failed:', error);
    }
  }
}

// Export singleton instance
export const redisCache = new RedisCacheService();

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down Redis cache service...');
  await redisCache.disconnect();
});

process.on('SIGINT', async () => {
  logger.info('Shutting down Redis cache service...');
  await redisCache.disconnect();
});
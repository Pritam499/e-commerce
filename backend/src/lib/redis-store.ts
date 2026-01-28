import { createClient, RedisClientType } from 'redis';
import { RateLimitStore } from './rate-limiter';

export class RedisStore implements RateLimitStore {
  private client: RedisClientType;
  private prefix: string;

  constructor(redisUrl?: string, prefix = 'ratelimit:') {
    this.prefix = prefix;
    this.client = createClient({
      url: redisUrl || process.env.REDIS_URL || 'redis://localhost:6379'
    });

    this.client.on('error', (err) => {
      console.error('Redis Client Error', err);
    });

    // Connect asynchronously
    this.connect();
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connect();
    } catch (error) {
      console.warn('Redis connection failed, falling back to memory store:', error);
    }
  }

  async increment(key: string): Promise<{ current: number; resetTime: number }> {
    const redisKey = this.prefix + key;
    const now = Date.now();
    const windowStart = Math.floor(now / 60000) * 60000; // 1-minute windows
    const windowKey = `${redisKey}:${windowStart}`;

    try {
      const result = await this.client.multi()
        .incr(windowKey)
        .pexpire(windowKey, 60000) // Expire in 1 minute
        .exec();

      const current = result?.[0] as number || 1;
      const resetTime = windowStart + 60000;

      return { current, resetTime };
    } catch (error) {
      // Fallback to in-memory if Redis fails
      console.warn('Redis increment failed:', error);
      throw error;
    }
  }

  async reset(key: string): Promise<void> {
    const redisKey = this.prefix + key;
    try {
      // Delete all keys matching the pattern
      const keys = await this.client.keys(`${redisKey}:*`);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
    } catch (error) {
      console.warn('Redis reset failed:', error);
    }
  }

  async cleanup(): Promise<void> {
    // Redis handles expiration automatically
    // This method exists for interface compatibility
  }

  // Additional Redis-specific methods
  async getTTL(key: string): Promise<number> {
    const redisKey = this.prefix + key;
    try {
      const keys = await this.client.keys(`${redisKey}:*`);
      if (keys.length === 0) return 0;

      const ttl = await this.client.pttl(keys[0]);
      return ttl;
    } catch {
      return 0;
    }
  }

  async getAllKeys(pattern = '*'): Promise<string[]> {
    try {
      return await this.client.keys(this.prefix + pattern);
    } catch {
      return [];
    }
  }

  async getStats(): Promise<{
    totalKeys: number;
    memoryUsage: string;
    connected: boolean;
  }> {
    try {
      const keys = await this.client.keys(this.prefix + '*');
      const info = await this.client.info('memory');

      return {
        totalKeys: keys.length,
        memoryUsage: info,
        connected: true,
      };
    } catch {
      return {
        totalKeys: 0,
        memoryUsage: 'N/A',
        connected: false,
      };
    }
  }

  // Graceful shutdown
  async disconnect(): Promise<void> {
    try {
      await this.client.disconnect();
    } catch (error) {
      console.warn('Redis disconnect error:', error);
    }
  }
}

// Lua script for atomic operations (better performance)
const INCREMENT_SCRIPT = `
  local key = KEYS[1]
  local now = tonumber(ARGV[1])
  local window = 60000  -- 1 minute
  local windowStart = math.floor(now / window) * window
  local windowKey = key .. ':' .. windowStart

  local current = redis.call('INCR', windowKey)
  redis.call('PEXPIRE', windowKey, window)

  return {current, windowStart + window}
`;

export class RedisLuaStore extends RedisStore {
  async increment(key: string): Promise<{ current: number; resetTime: number }> {
    const redisKey = this.prefix + key;
    const now = Date.now();

    try {
      const result = await this.client.eval(
        INCREMENT_SCRIPT,
        {
          keys: [redisKey],
          arguments: [now.toString()]
        }
      ) as [number, number];

      return { current: result[0], resetTime: result[1] };
    } catch (error) {
      // Fallback to basic Redis operations
      console.warn('Redis Lua script failed, using fallback:', error);
      return super.increment(key);
    }
  }
}

// Distributed rate limiting with Redis Cluster support
export class RedisClusterStore implements RateLimitStore {
  private clients: RedisStore[] = [];
  private currentClientIndex = 0;

  constructor(redisUrls: string[], prefix = 'ratelimit:') {
    this.clients = redisUrls.map(url => new RedisStore(url, prefix));
  }

  private getClient(key: string): RedisStore {
    // Simple hash-based client selection
    const hash = this.simpleHash(key);
    return this.clients[hash % this.clients.length];
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  async increment(key: string): Promise<{ current: number; resetTime: number }> {
    const client = this.getClient(key);
    return client.increment(key);
  }

  async reset(key: string): Promise<void> {
    // Reset on all clients to ensure consistency
    await Promise.allSettled(
      this.clients.map(client => client.reset(key))
    );
  }

  async cleanup(): Promise<void> {
    await Promise.allSettled(
      this.clients.map(client => client.cleanup())
    );
  }

  async getStats(): Promise<any> {
    const stats = await Promise.allSettled(
      this.clients.map(client => client.getStats())
    );

    return {
      clusterSize: this.clients.length,
      nodeStats: stats.map((result, index) => ({
        node: index,
        stats: result.status === 'fulfilled' ? result.value : null,
        error: result.status === 'rejected' ? result.reason : null,
      })),
    };
  }
}
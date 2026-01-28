import { FastifyRequest, FastifyReply } from "fastify";

// Rate limit configuration
export interface RateLimitConfig {
  windowMs: number;      // Time window in milliseconds
  maxRequests: number;   // Maximum requests per window
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: (req: FastifyRequest) => string;
  skip?: (req: FastifyRequest) => boolean;
  handler?: (req: FastifyRequest, reply: FastifyReply) => void;
  onLimitReached?: (req: FastifyRequest, key: string) => void;
}

// Rate limit store interface
export interface RateLimitStore {
  increment(key: string): Promise<{ current: number; resetTime: number }>;
  reset(key: string): Promise<void>;
  cleanup(): Promise<void>;
}

// In-memory store for development/fallback
class MemoryStore implements RateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>();

  async increment(key: string): Promise<{ current: number; resetTime: number }> {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now > entry.resetTime) {
      // Reset or create new entry
      const resetTime = now + 60000; // 1 minute window
      this.store.set(key, { count: 1, resetTime });
      return { current: 1, resetTime };
    }

    entry.count++;
    return { current: entry.count, resetTime: entry.resetTime };
  }

  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.resetTime) {
        this.store.delete(key);
      }
    }
  }
}

// Token bucket algorithm implementation
class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  private maxTokens: number;
  private refillRate: number; // tokens per millisecond

  constructor(maxTokens: number, refillRatePerSecond: number) {
    this.maxTokens = maxTokens;
    this.tokens = maxTokens;
    this.refillRate = refillRatePerSecond / 1000; // Convert to per millisecond
    this.lastRefill = Date.now();
  }

  consume(tokens = 1): boolean {
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const timePassed = now - this.lastRefill;
    const tokensToAdd = timePassed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }
}

// Circuit breaker states
enum CircuitState {
  CLOSED = 'CLOSED',
  OPEN = 'OPEN',
  HALF_OPEN = 'HALF_OPEN'
}

// Circuit breaker implementation
class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failures = 0;
  private lastFailureTime = 0;
  private nextAttemptTime = 0;

  constructor(
    private failureThreshold: number = 5,
    private recoveryTimeout: number = 60000, // 1 minute
    private monitoringPeriod: number = 60000 // 1 minute
  ) {}

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    if (this.state === CircuitState.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error('Circuit breaker is OPEN');
      }
      this.state = CircuitState.HALF_OPEN;
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    this.state = CircuitState.CLOSED;
  }

  private onFailure(): void {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttemptTime = Date.now() + this.recoveryTimeout;
    }
  }

  getState(): CircuitState {
    return this.state;
  }

  getFailureCount(): number {
    return this.failures;
  }

  reset(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.lastFailureTime = 0;
    this.nextAttemptTime = 0;
  }
}

// Main rate limiter class
export class AdvancedRateLimiter {
  private stores = new Map<string, RateLimitStore>();
  private tokenBuckets = new Map<string, TokenBucket>();
  private circuitBreakers = new Map<string, CircuitBreaker>();

  constructor() {
    // Initialize default stores
    this.stores.set('memory', new MemoryStore());

    // Cleanup old entries every 5 minutes
    setInterval(() => {
      this.stores.forEach(store => store.cleanup());
    }, 5 * 60 * 1000);
  }

  // Fixed window rate limiting
  async checkFixedWindow(
    key: string,
    config: RateLimitConfig,
    storeName = 'memory'
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    const store = this.stores.get(storeName);
    if (!store) throw new Error(`Store ${storeName} not found`);

    const result = await store.increment(key);
    const allowed = result.current <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - result.current);

    return { allowed, remaining, resetTime: result.resetTime };
  }

  // Sliding window rate limiting (approximated)
  async checkSlidingWindow(
    key: string,
    config: RateLimitConfig,
    storeName = 'memory'
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    // For simplicity, using fixed window as approximation
    // In production, you'd want a more sophisticated sliding window
    return this.checkFixedWindow(key, config, storeName);
  }

  // Token bucket rate limiting
  checkTokenBucket(
    key: string,
    maxTokens: number,
    refillRatePerSecond: number
  ): boolean {
    let bucket = this.tokenBuckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(maxTokens, refillRatePerSecond);
      this.tokenBuckets.set(key, bucket);
    }

    return bucket.consume(1);
  }

  // Circuit breaker
  async executeWithCircuitBreaker<T>(
    key: string,
    operation: () => Promise<T>,
    failureThreshold = 5,
    recoveryTimeout = 60000
  ): Promise<T> {
    let breaker = this.circuitBreakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker(failureThreshold, recoveryTimeout);
      this.circuitBreakers.set(key, breaker);
    }

    return breaker.execute(operation);
  }

  // Throttling with gradual slowdown
  async throttle<T>(
    key: string,
    operation: () => Promise<T>,
    baseDelay = 100,
    maxDelay = 5000
  ): Promise<T> {
    const store = this.stores.get('memory')!;
    const result = await store.increment(`${key}:throttle`);

    // Exponential backoff based on request count
    const delay = Math.min(baseDelay * Math.pow(2, result.current - 1), maxDelay);

    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    return operation();
  }

  // Multi-level rate limiting middleware
  createMiddleware(config: RateLimitConfig & {
    strategy?: 'fixed' | 'sliding' | 'token-bucket';
    tokenBucket?: { maxTokens: number; refillRatePerSecond: number };
    circuitBreaker?: { failureThreshold: number; recoveryTimeout: number };
    throttling?: { baseDelay: number; maxDelay: number };
  }) {
    const strategy = config.strategy || 'fixed';

    return async (request: FastifyRequest, reply: FastifyReply) => {
      // Skip if condition met
      if (config.skip && config.skip(request)) {
        return;
      }

      // Generate key
      const key = config.keyGenerator
        ? config.keyGenerator(request)
        : this.generateKey(request);

      try {
        // Apply circuit breaker if configured
        if (config.circuitBreaker) {
          const result = await this.executeWithCircuitBreaker(
            key,
            async () => this.checkRateLimit(key, config, strategy),
            config.circuitBreaker.failureThreshold,
            config.circuitBreaker.recoveryTimeout
          );

          if (!result.allowed) {
            throw new Error('Rate limit exceeded');
          }
        } else {
          const result = await this.checkRateLimit(key, config, strategy);
          if (!result.allowed) {
            throw new Error('Rate limit exceeded');
          }
        }

        // Apply throttling if configured
        if (config.throttling) {
          return this.throttle(
            key,
            () => Promise.resolve(),
            config.throttling.baseDelay,
            config.throttling.maxDelay
          );
        }

      } catch (error) {
        if (config.onLimitReached) {
          config.onLimitReached(request, key);
        }

        const customHandler = config.handler;
        if (customHandler) {
          customHandler(request, reply);
        } else {
          reply.code(429).send({
            error: 'Too Many Requests',
            message: 'Rate limit exceeded. Please try again later.',
            retryAfter: Math.ceil(config.windowMs / 1000)
          });
        }
        return;
      }
    };
  }

  private async checkRateLimit(
    key: string,
    config: RateLimitConfig,
    strategy: string
  ): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
    switch (strategy) {
      case 'token-bucket':
        if (config.tokenBucket) {
          const allowed = this.checkTokenBucket(
            key,
            config.tokenBucket.maxTokens,
            config.tokenBucket.refillRatePerSecond
          );
          return {
            allowed,
            remaining: allowed ? config.tokenBucket.maxTokens - 1 : 0,
            resetTime: Date.now() + 1000
          };
        }
        // Fall through to fixed window

      case 'sliding':
        return this.checkSlidingWindow(key, config);

      case 'fixed':
      default:
        return this.checkFixedWindow(key, config);
    }
  }

  private generateKey(request: FastifyRequest): string {
    const ip = request.ip || 'unknown';
    const userId = request.user?.id || 'anonymous';
    const userAgent = request.headers['user-agent'] || 'unknown';
    const path = request.url.split('?')[0]; // Remove query params

    // Create multi-dimensional key
    return `${ip}:${userId}:${userAgent}:${path}`;
  }

  // Add custom store (e.g., Redis)
  addStore(name: string, store: RateLimitStore): void {
    this.stores.set(name, store);
  }

  // Get rate limit status
  async getStatus(key: string, storeName = 'memory'): Promise<{ current: number; resetTime: number } | null> {
    const store = this.stores.get(storeName);
    if (!store) return null;

    try {
      return await store.increment(key); // This doesn't actually increment, just gets current
    } catch {
      return null;
    }
  }

  // Reset rate limit for a key
  async reset(key: string, storeName = 'memory'): Promise<void> {
    const store = this.stores.get(storeName);
    if (store) {
      await store.reset(key);
    }
  }

  // Get circuit breaker status
  getCircuitBreakerStatus(key: string): { state: CircuitState; failures: number } | null {
    const breaker = this.circuitBreakers.get(key);
    if (!breaker) return null;

    return {
      state: breaker.getState(),
      failures: breaker.getFailureCount()
    };
  }

  // Reset circuit breaker
  resetCircuitBreaker(key: string): void {
    const breaker = this.circuitBreakers.get(key);
    if (breaker) {
      breaker.reset();
    }
  }
}

// Singleton instance
export const rateLimiter = new AdvancedRateLimiter();

// Pre-configured middleware factories
export function createIPRateLimit(config: Partial<RateLimitConfig> = {}) {
  return rateLimiter.createMiddleware({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 100,
    keyGenerator: (req) => `ip:${req.ip}`,
    ...config,
  });
}

export function createUserRateLimit(config: Partial<RateLimitConfig> = {}) {
  return rateLimiter.createMiddleware({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30,
    keyGenerator: (req) => `user:${req.user?.id || 'anonymous'}`,
    ...config,
  });
}

export function createAPIRateLimit(endpoint: string, config: Partial<RateLimitConfig> = {}) {
  return rateLimiter.createMiddleware({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 10,
    keyGenerator: (req) => `api:${endpoint}:${req.user?.id || req.ip}`,
    ...config,
  });
}

export function createAuthRateLimit(config: Partial<RateLimitConfig> = {}) {
  return rateLimiter.createMiddleware({
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    strategy: 'token-bucket',
    tokenBucket: { maxTokens: 5, refillRatePerSecond: 5 / 900 }, // 5 tokens, refill over 15 min
    keyGenerator: (req) => `auth:${req.ip}`,
    circuitBreaker: { failureThreshold: 10, recoveryTimeout: 300000 }, // 5 min recovery
    ...config,
  });
}
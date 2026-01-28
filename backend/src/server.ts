import Fastify from "fastify";
import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { cartRoutes } from "./routes/cart";
import { checkoutRoutes } from "./routes/checkout";
import { productRoutes } from "./routes/products";
import { adminDiscountRoutes } from "./routes/admin/discounts";
import { adminStatsRoutes } from "./routes/admin/stats";
import { authRoutes } from "./routes/auth";
import { searchRoutes } from "./routes/search";
import { imageRoutes } from "./routes/images";
import { healthRoutes } from "./routes/health";
import { metricsRoutes } from "./routes/metrics";
import { monitoringMiddleware } from "./lib/monitoring";
import { authenticate } from "./lib/auth";
import { logger } from "./lib/logger";
import { maskObject } from "./lib/data-masking";
import {
  rateLimiter,
  createIPRateLimit,
  createUserRateLimit,
  createAPIRateLimit,
  createAuthRateLimit
} from "./lib/rate-limiter";
import { rateLimitMetrics, getRateLimitHealth } from "./lib/rate-limit-metrics";
import { adaptiveRateLimiter } from "./lib/adaptive-rate-limiter";
import { wsService } from "./lib/websocket-service";

// Try to add Redis store if available
try {
  const { RedisStore } = await import("./lib/redis-store");
  const redisStore = new RedisStore();
  rateLimiter.addStore('redis', redisStore);
  logger.info('Redis rate limiting store initialized');
} catch (error) {
  logger.warn('Redis not available, using in-memory store for rate limiting');
}

export async function buildServer() {
  const fastify = Fastify({
    logger: false, // Disable default logger, we'll use our secure one
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  // Add monitoring middleware
  fastify.addHook('preHandler', monitoringMiddleware);

  // Register cookie plugin
  await fastify.register(cookie);

  // Register WebSocket plugin
  await fastify.register(websocket, {
    options: {
      maxPayload: 1048576, // 1MB max payload
      perMessageDeflate: true,
    },
  });

  // Add authenticate decorator
  fastify.decorate("authenticate", authenticate);

  // Global adaptive rate limiting middleware
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/health') || request.url.startsWith('/metrics')) {
      return; // Skip rate limiting for health checks
    }

    const key = `global:${request.ip}`;
    const currentLimit = adaptiveRateLimiter.getCurrentLimit('global');

    const result = await rateLimiter.checkFixedWindow(key, {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: currentLimit,
    });

    if (!result.allowed) {
      rateLimitMetrics.recordBlocked(key);
      logger.security('IP rate limit exceeded', undefined, request.ip, {
        key,
        url: request.url,
        userAgent: request.headers['user-agent'],
        currentLimit,
        remaining: result.remaining,
      });

      return reply.code(429).send({
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(result.resetTime / 1000),
        limit: currentLimit,
        remaining: result.remaining,
      });
    }
  });

  // User-based adaptive rate limiting for authenticated requests
  fastify.addHook('preHandler', async (request, reply) => {
    if (!request.user || request.url.startsWith('/health')) {
      return;
    }

    const key = `user:${request.user.id}`;
    const currentLimit = adaptiveRateLimiter.getCurrentLimit('user');

    const result = await rateLimiter.checkFixedWindow(key, {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: currentLimit,
    });

    if (!result.allowed) {
      rateLimitMetrics.recordBlocked(key);
      logger.security('User rate limit exceeded', request.user.id, request.ip, {
        key,
        url: request.url,
        currentLimit,
        remaining: result.remaining,
      });

      return reply.code(429).send({
        error: 'Too Many Requests',
        message: 'User rate limit exceeded. Please try again later.',
        retryAfter: Math.ceil(result.resetTime / 1000),
        limit: currentLimit,
        remaining: result.remaining,
      });
    }
  });

  // Request logging middleware
  fastify.addHook('preHandler', (request, reply, done) => {
    const startTime = Date.now();

    // Record request in metrics
    const key = `global:${request.ip}`;
    rateLimitMetrics.recordRequest(key);

    // Log incoming request (without sensitive data)
    logger.api(
      request.method,
      request.url,
      0, // Will be set in onResponse
      request.user?.id,
      {
        userAgent: request.headers['user-agent'],
        ip: request.ip,
        query: maskObject(request.query),
        params: maskObject(request.params),
        body: maskObject(request.body),
      }
    );

    // Store start time for response logging
    (reply as any).startTime = startTime;
    done();
  });

  // Response logging middleware
  fastify.addHook('onResponse', (request, reply, done) => {
    const startTime = (reply as any).startTime || Date.now();
    const duration = Date.now() - startTime;

    logger.performance(`${request.method} ${request.url}`, duration, {
      statusCode: reply.statusCode,
      userId: request.user?.id,
    });

    done();
  });

  // Error logging middleware
  fastify.addHook('onError', (request, reply, error, done) => {
    logger.errorWithContext(error, `${request.method} ${request.url}`, request.user?.id, {
      statusCode: reply.statusCode,
      query: maskObject(request.query),
      params: maskObject(request.params),
      body: maskObject(request.body),
    });

    done();
  });

  // Security headers
  fastify.addHook('preHandler', (request, reply, done) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    done();
  });

  // Register routes
  await fastify.register(productRoutes);
  await fastify.register(searchRoutes);
  await fastify.register(imageRoutes);
  await fastify.register(healthRoutes);
  await fastify.register(metricsRoutes);
  await fastify.register(cartRoutes);
  await fastify.register(checkoutRoutes);
  await fastify.register(adminDiscountRoutes);
  await fastify.register(adminStatsRoutes);

  // Register auth routes with strict rate limiting
  await fastify.register(authRoutes, {
    prefix: "/auth",
  });

  // WebSocket route for real-time updates
  fastify.get('/ws', { websocket: true }, (connection, req) => {
    // The WebSocket service will handle the connection
    // This is just to register the route with Fastify WebSocket plugin
  });

  // Apply auth-specific adaptive rate limiting with circuit breaker
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.url.startsWith('/auth/')) {
      const key = `auth:${request.ip}`;
      const currentLimit = adaptiveRateLimiter.getCurrentLimit('auth');

      try {
        // Apply circuit breaker for auth endpoints
        const result = await rateLimiter.executeWithCircuitBreaker(
          key,
          async () => rateLimiter.checkTokenBucket(key, currentLimit, currentLimit / 900), // 15 min refill
          5, // 5 failures
          300000 // 5 min recovery
        );

        if (!result.allowed) {
          rateLimitMetrics.recordBlocked(key);
          logger.security('Auth rate limit exceeded', request.user?.id, request.ip, {
            key,
            url: request.url,
            currentLimit,
            remaining: result.remaining,
          });

          return reply.code(429).send({
            error: 'Too Many Requests',
            message: 'Authentication rate limit exceeded. Please try again later.',
            retryAfter: Math.ceil(result.resetTime / 1000),
            limit: currentLimit,
            remaining: result.remaining,
          });
        }
      } catch (error) {
        // Circuit breaker open
        logger.security('Auth circuit breaker open', request.user?.id, request.ip, {
          key,
          url: request.url,
        });

        return reply.code(503).send({
          error: 'Service Unavailable',
          message: 'Authentication service is temporarily unavailable. Please try again later.',
        });
      }
    }
  });

  // GDPR compliance endpoints
  fastify.delete('/api/gdpr/delete', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    // Log GDPR deletion request
    logger.gdpr('erasure', request.user!.id, {
      requestType: 'user_initiated_deletion',
    });

    // In a real implementation, you would:
    // 1. Anonymize user data instead of deleting
    // 2. Queue for actual deletion after retention period
    // 3. Send confirmation email

    return reply.send({
      message: 'Data deletion request processed. Your data will be anonymized within 30 days.',
      requestId: Date.now().toString(),
    });
  });

  fastify.get('/api/gdpr/export', {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    // Log GDPR export request
    logger.gdpr('portability', request.user!.id, {
      requestType: 'data_export',
    });

    // In a real implementation, you would:
    // 1. Gather all user data
    // 2. Format as JSON/CSV
    // 3. Send via email or provide download link

    return reply.send({
      message: 'Data export request processed. You will receive your data via email within 30 days.',
      requestId: Date.now().toString(),
    });
  });

  // Health check endpoint
  fastify.get('/health', async (request, reply) => {
    const rateLimitHealth = getRateLimitHealth();

    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      rateLimiting: rateLimitHealth,
      version: process.env.npm_package_version || '1.0.0',
    };

    // Return warning status if rate limiting is concerning
    if (rateLimitHealth.status === 'critical') {
      reply.code(503);
    } else if (rateLimitHealth.status === 'warning') {
      reply.code(200); // Still OK but with warning
    }

    return health;
  });

  // Metrics endpoint (protected)
  fastify.get('/metrics', {
    preHandler: [fastify.authenticate, (req, reply, done) => {
      // Only allow admin users to access metrics
      if (req.user?.role !== 'admin') {
        return reply.code(403).send({ error: 'Admin access required' });
      }
      done();
    }],
  }, async (request, reply) => {
    const metrics = rateLimitMetrics.exportForMonitoring();
    const circuitBreakers = {};

    // Get circuit breaker statuses for common keys
    const commonKeys = ['auth', 'api', 'global'];
    for (const key of commonKeys) {
      const status = rateLimiter.getCircuitBreakerStatus(key);
      if (status) {
        circuitBreakers[key] = status;
      }
    }

    return {
      ...metrics,
      circuitBreakers,
      adaptiveLimits: adaptiveRateLimiter.getStatus(),
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version,
      },
    };
  });

  // API-specific adaptive rate limiting for critical endpoints
  fastify.addHook('preHandler', async (request, reply) => {
    let endpointType: string | null = null;
    let currentLimit: number;

    // Checkout endpoint - strictest limits
    if (request.url.startsWith('/api/checkout')) {
      endpointType = 'checkout';
      currentLimit = adaptiveRateLimiter.getCurrentLimit('checkout');
    }
    // Admin endpoints - strict limits
    else if (request.url.startsWith('/api/admin/')) {
      endpointType = 'admin';
      currentLimit = adaptiveRateLimiter.getCurrentLimit('admin');
    }

    if (endpointType) {
      const key = `api:${endpointType}:${request.user?.id || request.ip}`;

      const result = await rateLimiter.checkFixedWindow(key, {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: currentLimit,
      });

      if (!result.allowed) {
        rateLimitMetrics.recordBlocked(key);
        logger.security(`${endpointType} rate limit exceeded`, request.user?.id, request.ip, {
          key,
          url: request.url,
          currentLimit,
          remaining: result.remaining,
        });

        return reply.code(429).send({
          error: 'Too Many Requests',
          message: `${endpointType} rate limit exceeded. Please try again later.`,
          retryAfter: Math.ceil(result.resetTime / 1000),
          limit: currentLimit,
          remaining: result.remaining,
        });
      }
    }
  });

  logger.info('Server started with advanced rate limiting and security enhancements');

  return fastify;
}

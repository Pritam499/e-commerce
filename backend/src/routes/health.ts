import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { monitoring } from "../lib/monitoring";
import { logger } from "../lib/logger";

interface HealthCheckResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version: string;
  services: {
    database: { status: 'healthy' | 'unhealthy'; latency?: number };
    redis: { status: 'healthy' | 'unhealthy'; latency?: number };
    elasticsearch: { status: 'healthy' | 'unhealthy'; latency?: number };
  };
  metrics?: {
    activeConnections: number;
    totalRequests: number;
    errorRate: number;
  };
}

export async function healthRoutes(fastify: FastifyInstance) {
  // Basic health check
  fastify.get("/health", async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      // Run all health checks in parallel
      const [dbHealth, redisHealth, esHealth] = await Promise.all([
        monitoring.checkDatabaseHealth(),
        monitoring.checkRedisHealth(),
        monitoring.checkElasticsearchHealth(),
      ]);

      const totalLatency = Date.now() - startTime;
      const hasDegradedService = [dbHealth, redisHealth, esHealth].some(
        service => service.status === 'unhealthy'
      );

      const status = hasDegradedService ? 'degraded' : 'healthy';

      const response: HealthCheckResponse = {
        status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        services: {
          database: dbHealth,
          redis: redisHealth,
          elasticsearch: esHealth,
        },
      };

      // Record health check metrics
      monitoring.recordBusinessOperation('health_check', status);

      logger.info('Health Check Completed', {
        status,
        totalLatency,
        services: response.services,
      });

      return reply.code(status === 'healthy' ? 200 : 503).send(response);
    } catch (error: any) {
      logger.error('Health Check Failed', { error: error.message });

      const response: HealthCheckResponse = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        services: {
          database: { status: 'unhealthy' },
          redis: { status: 'unhealthy' },
          elasticsearch: { status: 'unhealthy' },
        },
      };

      return reply.code(503).send(response);
    }
  });

  // Detailed health check with metrics
  fastify.get("/health/detailed", async (request: FastifyRequest, reply: FastifyReply) => {
    const startTime = Date.now();

    try {
      // Run health checks
      const [dbHealth, redisHealth, esHealth] = await Promise.all([
        monitoring.checkDatabaseHealth(),
        monitoring.checkRedisHealth(),
        monitoring.checkElasticsearchHealth(),
      ]);

      // Get system metrics
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();

      const hasDegradedService = [dbHealth, redisHealth, esHealth].some(
        service => service.status === 'unhealthy'
      );

      const status = hasDegradedService ? 'degraded' : 'healthy';

      const response: HealthCheckResponse & {
        system: {
          memory: { rss: number; heapTotal: number; heapUsed: number; external: number };
          cpu: { user: number; system: number };
          loadAverage: number[];
          platform: string;
          nodeVersion: string;
        };
        responseTime: number;
      } = {
        status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        services: {
          database: dbHealth,
          redis: redisHealth,
          elasticsearch: esHealth,
        },
        system: {
          memory: {
            rss: memUsage.rss,
            heapTotal: memUsage.heapTotal,
            heapUsed: memUsage.heapUsed,
            external: memUsage.external,
          },
          cpu: {
            user: cpuUsage.user,
            system: cpuUsage.system,
          },
          loadAverage: process.platform === 'win32' ? [] : require('os').loadavg(),
          platform: process.platform,
          nodeVersion: process.version,
        },
        responseTime: Date.now() - startTime,
      };

      monitoring.recordBusinessOperation('detailed_health_check', status);

      return reply.code(status === 'healthy' ? 200 : 503).send(response);
    } catch (error: any) {
      logger.error('Detailed Health Check Failed', { error: error.message });

      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: process.env.npm_package_version || '1.0.0',
        error: error.message,
      });
    }
  });

  // Readiness probe (for Kubernetes)
  fastify.get("/health/ready", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Check critical dependencies
      const [dbHealth, redisHealth] = await Promise.all([
        monitoring.checkDatabaseHealth(),
        monitoring.checkRedisHealth(),
      ]);

      const isReady = dbHealth.status === 'healthy' && redisHealth.status === 'healthy';

      monitoring.recordBusinessOperation('readiness_probe', isReady ? 'success' : 'failure');

      if (isReady) {
        return reply.code(200).send({ status: 'ready' });
      } else {
        return reply.code(503).send({
          status: 'not ready',
          services: { database: dbHealth, redis: redisHealth },
        });
      }
    } catch (error: any) {
      logger.error('Readiness Probe Failed', { error: error.message });
      return reply.code(503).send({ status: 'not ready', error: error.message });
    }
  });

  // Liveness probe (for Kubernetes)
  fastify.get("/health/live", async (request: FastifyRequest, reply: FastifyReply) => {
    // Simple liveness check - if the server is responding, it's alive
    monitoring.recordBusinessOperation('liveness_probe', 'success');
    return reply.code(200).send({ status: 'alive' });
  });

  // Service-specific health checks
  fastify.get("/health/database", async (request: FastifyRequest, reply: FastifyReply) => {
    const health = await monitoring.checkDatabaseHealth();

    return reply.code(health.status === 'healthy' ? 200 : 503).send({
      service: 'database',
      status: health.status,
      latency: health.latency,
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get("/health/redis", async (request: FastifyRequest, reply: FastifyReply) => {
    const health = await monitoring.checkRedisHealth();

    return reply.code(health.status === 'healthy' ? 200 : 503).send({
      service: 'redis',
      status: health.status,
      latency: health.latency,
      timestamp: new Date().toISOString(),
    });
  });

  fastify.get("/health/elasticsearch", async (request: FastifyRequest, reply: FastifyReply) => {
    const health = await monitoring.checkElasticsearchHealth();

    return reply.code(health.status === 'healthy' ? 200 : 503).send({
      service: 'elasticsearch',
      status: health.status,
      latency: health.latency,
      timestamp: new Date().toISOString(),
    });
  });
}
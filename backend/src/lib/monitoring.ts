import promClient from 'prom-client';
import { logger } from './logger';
import { db } from './db';
import { redisStore } from './redis-store';

// Create a Registry for metrics
const register = new promClient.Registry();

// Add default metrics (CPU, memory, etc.)
promClient.collectDefaultMetrics({ register });

// Custom metrics
const httpRequestDuration = new promClient.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

const httpRequestsTotal = new promClient.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

const activeConnections = new promClient.Gauge({
  name: 'active_connections',
  help: 'Number of active connections',
});

const databaseQueryDuration = new promClient.Histogram({
  name: 'database_query_duration_seconds',
  help: 'Duration of database queries in seconds',
  labelNames: ['operation', 'table'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

const redisOperationsTotal = new promClient.Counter({
  name: 'redis_operations_total',
  help: 'Total number of Redis operations',
  labelNames: ['operation', 'key'],
});

const elasticsearchQueryDuration = new promClient.Histogram({
  name: 'elasticsearch_query_duration_seconds',
  help: 'Duration of Elasticsearch queries in seconds',
  labelNames: ['operation', 'index'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

const imageProcessingDuration = new promClient.Histogram({
  name: 'image_processing_duration_seconds',
  help: 'Duration of image processing operations',
  labelNames: ['operation', 'format'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
});

const rateLimitHits = new promClient.Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of rate limit hits',
  labelNames: ['endpoint', 'type'],
});

const businessMetrics = new promClient.Counter({
  name: 'business_operations_total',
  help: 'Total number of business operations',
  labelNames: ['operation', 'status'],
});

const errorRate = new promClient.Counter({
  name: 'application_errors_total',
  help: 'Total number of application errors',
  labelNames: ['type', 'endpoint'],
});

// Register all metrics
register.registerMetric(httpRequestDuration);
register.registerMetric(httpRequestsTotal);
register.registerMetric(activeConnections);
register.registerMetric(databaseQueryDuration);
register.registerMetric(redisOperationsTotal);
register.registerMetric(elasticsearchQueryDuration);
register.registerMetric(imageProcessingDuration);
register.registerMetric(rateLimitHits);
register.registerMetric(businessMetrics);
register.registerMetric(errorRate);

export class MonitoringService {
  private static instance: MonitoringService;

  static getInstance(): MonitoringService {
    if (!MonitoringService.instance) {
      MonitoringService.instance = new MonitoringService();
    }
    return MonitoringService.instance;
  }

  // HTTP request monitoring
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number) {
    httpRequestsTotal.inc({ method, route, status_code: statusCode.toString() });
    httpRequestDuration.observe({ method, route, status_code: statusCode.toString() }, duration);

    logger.info('HTTP Request', {
      method,
      route,
      statusCode,
      duration,
      timestamp: new Date().toISOString(),
    });
  }

  // Database query monitoring
  recordDatabaseQuery(operation: string, table: string, duration: number) {
    databaseQueryDuration.observe({ operation, table }, duration);

    if (duration > 1.0) { // Log slow queries
      logger.warn('Slow Database Query', {
        operation,
        table,
        duration,
        threshold: '1s',
      });
    }
  }

  // Redis operation monitoring
  recordRedisOperation(operation: string, key?: string) {
    redisOperationsTotal.inc({ operation, key: key || 'unknown' });
  }

  // Elasticsearch query monitoring
  recordElasticsearchQuery(operation: string, index: string, duration: number) {
    elasticsearchQueryDuration.observe({ operation, index }, duration);

    if (duration > 0.5) { // Log slow ES queries
      logger.warn('Slow Elasticsearch Query', {
        operation,
        index,
        duration,
        threshold: '500ms',
      });
    }
  }

  // Image processing monitoring
  recordImageProcessing(operation: string, format: string, duration: number) {
    imageProcessingDuration.observe({ operation, format }, duration);
  }

  // Rate limit monitoring
  recordRateLimitHit(endpoint: string, type: string = 'global') {
    rateLimitHits.inc({ endpoint, type });
  }

  // Business metrics
  recordBusinessOperation(operation: string, status: 'success' | 'failure') {
    businessMetrics.inc({ operation, status });
  }

  // Error tracking
  recordError(type: string, endpoint?: string, error?: any) {
    errorRate.inc({ type, endpoint: endpoint || 'unknown' });

    logger.error('Application Error', {
      type,
      endpoint,
      error: error?.message || 'Unknown error',
      stack: error?.stack,
    });
  }

  // Active connections
  updateActiveConnections(count: number) {
    activeConnections.set(count);
  }

  // Health check methods
  async checkDatabaseHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number }> {
    const startTime = Date.now();

    try {
      await db.execute('SELECT 1');
      const latency = Date.now() - startTime;
      return { status: 'healthy', latency };
    } catch (error) {
      logger.error('Database Health Check Failed', { error: error.message });
      return { status: 'unhealthy' };
    }
  }

  async checkRedisHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number }> {
    const startTime = Date.now();

    try {
      await redisStore.get('health_check');
      const latency = Date.now() - startTime;
      return { status: 'healthy', latency };
    } catch (error) {
      logger.error('Redis Health Check Failed', { error: error.message });
      return { status: 'unhealthy' };
    }
  }

  async checkElasticsearchHealth(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number }> {
    const startTime = Date.now();

    try {
      // This would need to be implemented with the ES client
      // For now, return healthy
      const latency = Date.now() - startTime;
      return { status: 'healthy', latency };
    } catch (error) {
      logger.error('Elasticsearch Health Check Failed', { error: error.message });
      return { status: 'unhealthy' };
    }
  }

  // Get metrics for Prometheus scraping
  getMetrics(): Promise<string> {
    return register.metrics();
  }

  // Get registry for middleware
  getRegistry(): promClient.Registry {
    return register;
  }
}

// Global monitoring instance
export const monitoring = MonitoringService.getInstance();

// Middleware for HTTP request monitoring
export const monitoringMiddleware = (request: any, reply: any, next: any) => {
  const startTime = Date.now();

  // Track active connections
  monitoring.updateActiveConnections((global as any).activeConnections || 0);

  reply.raw.on('finish', () => {
    const duration = (Date.now() - startTime) / 1000; // Convert to seconds
    const method = request.method;
    const route = request.route?.path || request.url;
    const statusCode = reply.statusCode;

    monitoring.recordHttpRequest(method, route, statusCode, duration);

    // Log errors
    if (statusCode >= 400) {
      monitoring.recordError('http_error', route, { statusCode, method });
    }
  });

  next();
};
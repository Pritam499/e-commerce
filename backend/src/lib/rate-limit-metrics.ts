import { rateLimiter } from './rate-limiter';

// Metrics collection for rate limiting
export class RateLimitMetrics {
  private metrics = new Map<string, {
    requests: number;
    blocked: number;
    circuitBreakerTrips: number;
    throttlingDelays: number[];
    lastUpdated: number;
  }>();

  // Record a successful request
  recordRequest(key: string): void {
    this.ensureMetric(key);
    this.metrics.get(key)!.requests++;
    this.metrics.get(key)!.lastUpdated = Date.now();
  }

  // Record a blocked request
  recordBlocked(key: string): void {
    this.ensureMetric(key);
    this.metrics.get(key)!.blocked++;
    this.metrics.get(key)!.lastUpdated = Date.now();
  }

  // Record circuit breaker trip
  recordCircuitBreakerTrip(key: string): void {
    this.ensureMetric(key);
    this.metrics.get(key)!.circuitBreakerTrips++;
    this.metrics.get(key)!.lastUpdated = Date.now();
  }

  // Record throttling delay
  recordThrottlingDelay(key: string, delay: number): void {
    this.ensureMetric(key);
    this.metrics.get(key)!.throttlingDelays.push(delay);
    // Keep only last 100 delays
    if (this.metrics.get(key)!.throttlingDelays.length > 100) {
      this.metrics.get(key)!.throttlingDelays.shift();
    }
    this.metrics.get(key)!.lastUpdated = Date.now();
  }

  private ensureMetric(key: string): void {
    if (!this.metrics.has(key)) {
      this.metrics.set(key, {
        requests: 0,
        blocked: 0,
        circuitBreakerTrips: 0,
        throttlingDelays: [],
        lastUpdated: Date.now(),
      });
    }
  }

  // Get metrics for a key
  getMetrics(key: string): {
    requests: number;
    blocked: number;
    blockRate: number;
    circuitBreakerTrips: number;
    avgThrottlingDelay: number;
    lastUpdated: number;
  } | null {
    const metric = this.metrics.get(key);
    if (!metric) return null;

    const totalRequests = metric.requests + metric.blocked;
    const blockRate = totalRequests > 0 ? metric.blocked / totalRequests : 0;
    const avgThrottlingDelay = metric.throttlingDelays.length > 0
      ? metric.throttlingDelays.reduce((a, b) => a + b, 0) / metric.throttlingDelays.length
      : 0;

    return {
      requests: metric.requests,
      blocked: metric.blocked,
      blockRate,
      circuitBreakerTrips: metric.circuitBreakerTrips,
      avgThrottlingDelay,
      lastUpdated: metric.lastUpdated,
    };
  }

  // Get all metrics
  getAllMetrics(): Record<string, any> {
    const result: Record<string, any> = {};

    for (const [key, metric] of this.metrics.entries()) {
      result[key] = this.getMetrics(key);
    }

    return result;
  }

  // Get aggregated metrics
  getAggregatedMetrics(): {
    totalRequests: number;
    totalBlocked: number;
    overallBlockRate: number;
    totalCircuitBreakerTrips: number;
    avgThrottlingDelay: number;
    activeKeys: number;
  } {
    let totalRequests = 0;
    let totalBlocked = 0;
    let totalCircuitBreakerTrips = 0;
    let totalThrottlingDelay = 0;
    let throttlingDelayCount = 0;

    for (const metric of this.metrics.values()) {
      totalRequests += metric.requests;
      totalBlocked += metric.blocked;
      totalCircuitBreakerTrips += metric.circuitBreakerTrips;
      totalThrottlingDelay += metric.throttlingDelays.reduce((a, b) => a + b, 0);
      throttlingDelayCount += metric.throttlingDelays.length;
    }

    const overallBlockRate = (totalRequests + totalBlocked) > 0
      ? totalBlocked / (totalRequests + totalBlocked)
      : 0;

    const avgThrottlingDelay = throttlingDelayCount > 0
      ? totalThrottlingDelay / throttlingDelayCount
      : 0;

    return {
      totalRequests,
      totalBlocked,
      overallBlockRate,
      totalCircuitBreakerTrips,
      avgThrottlingDelay,
      activeKeys: this.metrics.size,
    };
  }

  // Clean up old metrics (older than specified time)
  cleanup(maxAge: number = 24 * 60 * 60 * 1000): void { // 24 hours
    const cutoff = Date.now() - maxAge;

    for (const [key, metric] of this.metrics.entries()) {
      if (metric.lastUpdated < cutoff) {
        this.metrics.delete(key);
      }
    }
  }

  // Export metrics for monitoring systems
  exportForMonitoring(): {
    timestamp: number;
    metrics: Record<string, any>;
    aggregated: any;
  } {
    return {
      timestamp: Date.now(),
      metrics: this.getAllMetrics(),
      aggregated: this.getAggregatedMetrics(),
    };
  }
}

// Global metrics instance
export const rateLimitMetrics = new RateLimitMetrics();

// Periodic cleanup
setInterval(() => {
  rateLimitMetrics.cleanup();
}, 60 * 60 * 1000); // Clean up every hour

// Health check endpoint data
export function getRateLimitHealth(): {
  status: 'healthy' | 'warning' | 'critical';
  message: string;
  metrics: any;
} {
  const aggregated = rateLimitMetrics.getAggregatedMetrics();

  // Define thresholds
  const WARNING_BLOCK_RATE = 0.1; // 10%
  const CRITICAL_BLOCK_RATE = 0.3; // 30%
  const CRITICAL_CIRCUIT_BREAKERS = 5;

  if (aggregated.overallBlockRate >= CRITICAL_BLOCK_RATE ||
      aggregated.totalCircuitBreakerTrips >= CRITICAL_CIRCUIT_BREAKERS) {
    return {
      status: 'critical',
      message: 'High rate limiting activity detected',
      metrics: aggregated,
    };
  }

  if (aggregated.overallBlockRate >= WARNING_BLOCK_RATE) {
    return {
      status: 'warning',
      message: 'Elevated rate limiting activity',
      metrics: aggregated,
    };
  }

  return {
    status: 'healthy',
    message: 'Rate limiting operating normally',
    metrics: aggregated,
  };
}
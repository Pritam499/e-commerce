import { rateLimiter } from './rate-limiter';
import { rateLimitMetrics } from './rate-limit-metrics';
import { logger } from './logger';

interface SystemLoad {
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: number;
  responseTime: number;
}

interface AdaptiveConfig {
  targetCpuUsage: number; // Target CPU usage (0-1)
  targetMemoryUsage: number; // Target memory usage (0-1)
  targetResponseTime: number; // Target response time in ms
  adjustmentInterval: number; // How often to adjust limits (ms)
  minRequestsPerWindow: number; // Minimum requests allowed
  maxRequestsPerWindow: number; // Maximum requests allowed
  scalingFactor: number; // How aggressively to scale
}

export class AdaptiveRateLimiter {
  private baseLimits = new Map<string, number>();
  private currentLimits = new Map<string, number>();
  private lastAdjustment = Date.now();
  private loadHistory: SystemLoad[] = [];
  private maxHistorySize = 10;

  constructor(private config: AdaptiveConfig) {
    // Start adaptive adjustment loop
    setInterval(() => this.adjustLimits(), config.adjustmentInterval);
  }

  // Set base limit for an endpoint/key
  setBaseLimit(key: string, limit: number): void {
    this.baseLimits.set(key, limit);
    this.currentLimits.set(key, limit);
  }

  // Get current adaptive limit
  getCurrentLimit(key: string): number {
    return this.currentLimits.get(key) || this.baseLimits.get(key) || 100;
  }

  // Record system load
  recordLoad(load: SystemLoad): void {
    this.loadHistory.push(load);

    // Keep only recent history
    if (this.loadHistory.length > this.maxHistorySize) {
      this.loadHistory.shift();
    }
  }

  // Calculate average load over recent history
  private getAverageLoad(): SystemLoad | null {
    if (this.loadHistory.length === 0) return null;

    const sum = this.loadHistory.reduce(
      (acc, load) => ({
        cpuUsage: acc.cpuUsage + load.cpuUsage,
        memoryUsage: acc.memoryUsage + load.memoryUsage,
        activeConnections: acc.activeConnections + load.activeConnections,
        responseTime: acc.responseTime + load.responseTime,
      }),
      { cpuUsage: 0, memoryUsage: 0, activeConnections: 0, responseTime: 0 }
    );

    return {
      cpuUsage: sum.cpuUsage / this.loadHistory.length,
      memoryUsage: sum.memoryUsage / this.loadHistory.length,
      activeConnections: sum.activeConnections / this.loadHistory.length,
      responseTime: sum.responseTime / this.loadHistory.length,
    };
  }

  // Adjust limits based on current system load
  private adjustLimits(): void {
    const now = Date.now();
    if (now - this.lastAdjustment < this.config.adjustmentInterval) {
      return;
    }

    const avgLoad = this.getAverageLoad();
    if (!avgLoad) return;

    const health = rateLimitMetrics.getAggregatedMetrics();
    let scalingFactor = 1.0;

    // CPU-based scaling
    if (avgLoad.cpuUsage > this.config.targetCpuUsage * 1.2) {
      // High CPU usage - reduce limits aggressively
      scalingFactor *= 0.7;
      logger.warn('High CPU usage detected, reducing rate limits', {
        cpuUsage: avgLoad.cpuUsage,
        target: this.config.targetCpuUsage,
        scalingFactor,
      });
    } else if (avgLoad.cpuUsage < this.config.targetCpuUsage * 0.8) {
      // Low CPU usage - can increase limits
      scalingFactor *= 1.2;
    }

    // Memory-based scaling
    if (avgLoad.memoryUsage > this.config.targetMemoryUsage * 1.1) {
      scalingFactor *= 0.8;
      logger.warn('High memory usage detected, reducing rate limits', {
        memoryUsage: avgLoad.memoryUsage,
        target: this.config.targetMemoryUsage,
        scalingFactor,
      });
    }

    // Response time-based scaling
    if (avgLoad.responseTime > this.config.targetResponseTime * 1.5) {
      scalingFactor *= 0.6;
      logger.warn('High response time detected, reducing rate limits', {
        responseTime: avgLoad.responseTime,
        target: this.config.targetResponseTime,
        scalingFactor,
      });
    } else if (avgLoad.responseTime < this.config.targetResponseTime * 0.8) {
      scalingFactor *= 1.1;
    }

    // Rate limiting effectiveness - if we're blocking too many requests, system might be under attack
    if (health.overallBlockRate > 0.2) {
      scalingFactor *= 0.5;
      logger.warn('High block rate detected, aggressively reducing limits', {
        blockRate: health.overallBlockRate,
        scalingFactor,
      });
    }

    // Apply scaling to all limits
    for (const [key, baseLimit] of this.baseLimits.entries()) {
      const newLimit = Math.max(
        this.config.minRequestsPerWindow,
        Math.min(
          this.config.maxRequestsPerWindow,
          Math.round(baseLimit * scalingFactor)
        )
      );

      if (newLimit !== this.currentLimits.get(key)) {
        logger.info('Adjusted rate limit', {
          key,
          oldLimit: this.currentLimits.get(key),
          newLimit,
          scalingFactor,
          reason: this.getAdjustmentReason(avgLoad, health),
        });

        this.currentLimits.set(key, newLimit);
      }
    }

    this.lastAdjustment = now;
  }

  private getAdjustmentReason(load: SystemLoad, health: any): string {
    const reasons = [];

    if (load.cpuUsage > this.config.targetCpuUsage * 1.2) {
      reasons.push('high_cpu');
    }
    if (load.memoryUsage > this.config.targetMemoryUsage * 1.1) {
      reasons.push('high_memory');
    }
    if (load.responseTime > this.config.targetResponseTime * 1.5) {
      reasons.push('high_response_time');
    }
    if (health.overallBlockRate > 0.2) {
      reasons.push('high_block_rate');
    }

    return reasons.join(',');
  }

  // Get system load (would be implemented with actual system monitoring)
  async getSystemLoad(): Promise<SystemLoad> {
    // In a real implementation, you'd use:
    // - os.loadavg() for CPU
    // - process.memoryUsage() for memory
    // - Connection counting for active connections
    // - Response time tracking

    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      cpuUsage: cpuUsage.user / 1000000, // Rough CPU usage estimate
      memoryUsage: memUsage.heapUsed / memUsage.heapTotal,
      activeConnections: 0, // Would need to track this
      responseTime: 100, // Would need to measure this
    };
  }

  // Manual override for emergency situations
  emergencyReduceLimits(reductionFactor = 0.5): void {
    logger.warn('Emergency rate limit reduction activated', { reductionFactor });

    for (const [key, baseLimit] of this.baseLimits.entries()) {
      const newLimit = Math.max(
        this.config.minRequestsPerWindow,
        Math.round(baseLimit * reductionFactor)
      );

      this.currentLimits.set(key, newLimit);
    }
  }

  // Reset to base limits
  resetToBaseLimits(): void {
    logger.info('Resetting rate limits to base values');

    for (const [key, baseLimit] of this.baseLimits.entries()) {
      this.currentLimits.set(key, baseLimit);
    }
  }

  // Get current status
  getStatus(): {
    limits: Record<string, { base: number; current: number; ratio: number }>;
    load: SystemLoad | null;
    health: any;
  } {
    const limits: Record<string, { base: number; current: number; ratio: number }> = {};

    for (const [key, baseLimit] of this.baseLimits.entries()) {
      const current = this.currentLimits.get(key) || baseLimit;
      limits[key] = {
        base: baseLimit,
        current,
        ratio: current / baseLimit,
      };
    }

    return {
      limits,
      load: this.getAverageLoad(),
      health: rateLimitMetrics.getAggregatedMetrics(),
    };
  }
}

// Global adaptive rate limiter
export const adaptiveRateLimiter = new AdaptiveRateLimiter({
  targetCpuUsage: 0.7, // 70% CPU target
  targetMemoryUsage: 0.8, // 80% memory target
  targetResponseTime: 500, // 500ms target response time
  adjustmentInterval: 30000, // Adjust every 30 seconds
  minRequestsPerWindow: 10, // Minimum 10 requests per window
  maxRequestsPerWindow: 1000, // Maximum 1000 requests per window
  scalingFactor: 1.0,
});

// Initialize with default limits
adaptiveRateLimiter.setBaseLimit('global', 1000);
adaptiveRateLimiter.setBaseLimit('user', 120);
adaptiveRateLimiter.setBaseLimit('auth', 5);
adaptiveRateLimiter.setBaseLimit('checkout', 5);
adaptiveRateLimiter.setBaseLimit('admin', 10);

// Periodic load monitoring
setInterval(async () => {
  try {
    const load = await adaptiveRateLimiter.getSystemLoad();
    adaptiveRateLimiter.recordLoad(load);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to record system load', { error: errorMessage });
  }
}, 10000); // Every 10 seconds
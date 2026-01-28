import { logger } from './logger';
import { rateLimitMetrics } from './rate-limit-metrics';

interface ServerNode {
  id: string;
  url: string;
  weight: number; // Load balancing weight
  health: 'healthy' | 'warning' | 'critical' | 'down';
  lastHealthCheck: number;
  metrics: {
    activeConnections: number;
    responseTime: number;
    errorRate: number;
    rateLimitBlockRate: number;
  };
}

interface LoadBalancingStrategy {
  selectNode(nodes: ServerNode[], request: any): ServerNode | null;
}

class RoundRobinStrategy implements LoadBalancingStrategy {
  private currentIndex = 0;

  selectNode(nodes: ServerNode[]): ServerNode | null {
    const healthyNodes = nodes.filter(n => n.health === 'healthy');

    if (healthyNodes.length === 0) return null;

    const node = healthyNodes[this.currentIndex % healthyNodes.length];
    this.currentIndex = (this.currentIndex + 1) % healthyNodes.length;

    return node;
  }
}

class LeastConnectionsStrategy implements LoadBalancingStrategy {
  selectNode(nodes: ServerNode[]): ServerNode | null {
    const healthyNodes = nodes.filter(n => n.health === 'healthy');

    if (healthyNodes.length === 0) return null;

    // Select node with least active connections
    return healthyNodes.reduce((min, node) =>
      node.metrics.activeConnections < min.metrics.activeConnections ? node : min
    );
  }
}

class WeightedRoundRobinStrategy implements LoadBalancingStrategy {
  private currentWeights = new Map<string, number>();

  selectNode(nodes: ServerNode[]): ServerNode | null {
    const healthyNodes = nodes.filter(n => n.health === 'healthy');

    if (healthyNodes.length === 0) return null;

    // Reset weights if needed
    if (this.currentWeights.size !== healthyNodes.length) {
      healthyNodes.forEach(node => {
        this.currentWeights.set(node.id, 0);
      });
    }

    // Find node with highest remaining weight
    let selectedNode: ServerNode | null = null;
    let maxWeight = -1;

    for (const node of healthyNodes) {
      const currentWeight = this.currentWeights.get(node.id) || 0;
      const effectiveWeight = currentWeight + node.weight;

      if (effectiveWeight > maxWeight) {
        maxWeight = effectiveWeight;
        selectedNode = node;
      }
    }

    if (selectedNode) {
      // Decrease the weight for next selection
      const newWeight = (this.currentWeights.get(selectedNode.id) || 0) + selectedNode.weight - 1;
      this.currentWeights.set(selectedNode.id, Math.max(0, newWeight));
    }

    return selectedNode;
  }
}

class AdaptiveStrategy implements LoadBalancingStrategy {
  selectNode(nodes: ServerNode[], request: any): ServerNode | null {
    const healthyNodes = nodes.filter(n => n.health === 'healthy');

    if (healthyNodes.length === 0) return null;

    // Score nodes based on multiple factors
    const scoredNodes = healthyNodes.map(node => {
      let score = node.weight;

      // Penalize high response time
      score -= node.metrics.responseTime / 100; // -1 point per 100ms

      // Penalize high error rate
      score -= node.metrics.errorRate * 10; // -10 points per 10% error rate

      // Penalize high rate limit block rate
      score -= node.metrics.rateLimitBlockRate * 5; // -5 points per 20% block rate

      // Bonus for low connection count
      const avgConnections = healthyNodes.reduce((sum, n) => sum + n.metrics.activeConnections, 0) / healthyNodes.length;
      if (node.metrics.activeConnections < avgConnections) {
        score += 1;
      }

      return { node, score };
    });

    // Select highest scoring node
    const bestNode = scoredNodes.reduce((best, current) =>
      current.score > best.score ? current : best
    );

    return bestNode.node;
  }
}

export class LoadBalancer {
  private nodes: ServerNode[] = [];
  private strategy: LoadBalancingStrategy;
  private healthCheckInterval: number;

  constructor(
    strategy: 'round-robin' | 'least-connections' | 'weighted' | 'adaptive' = 'adaptive',
    healthCheckInterval = 30000 // 30 seconds
  ) {
    this.setStrategy(strategy);
    this.healthCheckInterval = healthCheckInterval;

    // Start health checks
    setInterval(() => this.performHealthChecks(), this.healthCheckInterval);
  }

  setStrategy(type: 'round-robin' | 'least-connections' | 'weighted' | 'adaptive'): void {
    switch (type) {
      case 'round-robin':
        this.strategy = new RoundRobinStrategy();
        break;
      case 'least-connections':
        this.strategy = new LeastConnectionsStrategy();
        break;
      case 'weighted':
        this.strategy = new WeightedRoundRobinStrategy();
        break;
      case 'adaptive':
        this.strategy = new AdaptiveStrategy();
        break;
    }

    logger.info('Load balancer strategy changed', { strategy: type });
  }

  addNode(node: Omit<ServerNode, 'health' | 'lastHealthCheck' | 'metrics'>): void {
    const fullNode: ServerNode = {
      ...node,
      health: 'healthy',
      lastHealthCheck: Date.now(),
      metrics: {
        activeConnections: 0,
        responseTime: 0,
        errorRate: 0,
        rateLimitBlockRate: 0,
      },
    };

    this.nodes.push(fullNode);
    logger.info('Node added to load balancer', { nodeId: node.id, url: node.url });
  }

  removeNode(nodeId: string): void {
    const index = this.nodes.findIndex(n => n.id === nodeId);
    if (index !== -1) {
      this.nodes.splice(index, 1);
      logger.info('Node removed from load balancer', { nodeId });
    }
  }

  selectNode(request: any): ServerNode | null {
    return this.strategy.selectNode(this.nodes, request);
  }

  async performHealthChecks(): Promise<void> {
    const healthCheckPromises = this.nodes.map(async (node) => {
      try {
        const startTime = Date.now();

        // Perform health check
        const response = await fetch(`${node.url}/health`, {
          timeout: 5000, // 5 second timeout
        });

        const responseTime = Date.now() - startTime;
        const isHealthy = response.ok;

        if (isHealthy) {
          const healthData = await response.json();
          const rateLimitHealth = healthData.rateLimiting || {};

          // Update node metrics
          node.metrics.responseTime = responseTime;
          node.metrics.errorRate = rateLimitHealth.metrics?.overallBlockRate || 0;
          node.metrics.rateLimitBlockRate = rateLimitHealth.metrics?.overallBlockRate || 0;
          node.health = rateLimitHealth.status === 'healthy' ? 'healthy' :
                       rateLimitHealth.status === 'warning' ? 'warning' : 'critical';
        } else {
          node.health = 'critical';
        }

      } catch (error) {
        node.health = 'down';
        logger.warn('Health check failed for node', {
          nodeId: node.id,
          url: node.url,
          error: error.message
        });
      }

      node.lastHealthCheck = Date.now();
    });

    await Promise.allSettled(healthCheckPromises);

    // Log cluster health
    const healthyCount = this.nodes.filter(n => n.health === 'healthy').length;
    const totalCount = this.nodes.length;

    if (healthyCount < totalCount * 0.5) {
      logger.warn('Low cluster health detected', {
        healthyNodes: healthyCount,
        totalNodes: totalCount,
        unhealthyNodes: this.nodes.filter(n => n.health !== 'healthy').map(n => ({
          id: n.id,
          health: n.health,
        })),
      });
    }
  }

  updateNodeMetrics(nodeId: string, metrics: Partial<ServerNode['metrics']>): void {
    const node = this.nodes.find(n => n.id === nodeId);
    if (node) {
      Object.assign(node.metrics, metrics);
    }
  }

  getClusterStatus(): {
    totalNodes: number;
    healthyNodes: number;
    unhealthyNodes: ServerNode[];
    strategy: string;
    nodes: Array<{
      id: string;
      url: string;
      health: string;
      weight: number;
      metrics: ServerNode['metrics'];
    }>;
  } {
    const healthyNodes = this.nodes.filter(n => n.health === 'healthy');
    const unhealthyNodes = this.nodes.filter(n => n.health !== 'healthy');

    return {
      totalNodes: this.nodes.length,
      healthyNodes: healthyNodes.length,
      unhealthyNodes,
      strategy: this.strategy.constructor.name,
      nodes: this.nodes.map(n => ({
        id: n.id,
        url: n.url,
        health: n.health,
        weight: n.weight,
        metrics: n.metrics,
      })),
    };
  }

  // Emergency failover - mark all nodes as critical except one
  emergencyFailover(keepNodeId: string): void {
    logger.warn('Emergency failover activated', { keepNodeId });

    this.nodes.forEach(node => {
      if (node.id === keepNodeId) {
        node.health = 'healthy';
        node.weight = 100; // Give it maximum weight
      } else {
        node.health = 'critical';
        node.weight = 0; // Remove from rotation
      }
    });
  }

  // Recovery - gradually bring nodes back online
  async recoveryPhase(): Promise<void> {
    logger.info('Starting recovery phase');

    for (const node of this.nodes) {
      try {
        // Test the node
        const response = await fetch(`${node.url}/health`, { timeout: 10000 });
        if (response.ok) {
          node.health = 'warning'; // Start with warning status
          node.weight = Math.floor(node.weight * 0.5); // 50% weight initially

          logger.info('Node recovered', { nodeId: node.id });

          // Gradually increase weight
          setTimeout(() => {
            if (node.health !== 'down') {
              node.health = 'healthy';
              node.weight = Math.floor(node.weight * 2); // Back to normal
            }
          }, 60000); // After 1 minute
        }
      } catch (error) {
        logger.warn('Node still unhealthy during recovery', {
          nodeId: node.id,
          error: error.message
        });
      }
    }
  }
}

// Global load balancer instance
export const loadBalancer = new LoadBalancer('adaptive');

// Add current server as first node
loadBalancer.addNode({
  id: 'primary',
  url: process.env.SERVER_URL || `http://localhost:${process.env.PORT || 3001}`,
  weight: 100,
});

// Export for use in request proxying
export async function proxyRequest(request: any, targetNode: ServerNode): Promise<Response> {
  const url = new URL(request.url);
  url.host = new URL(targetNode.url).host;
  url.port = new URL(targetNode.url).port;
  url.protocol = new URL(targetNode.url).protocol;

  try {
    const response = await fetch(url.toString(), {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
    });

    // Update node metrics
    loadBalancer.updateNodeMetrics(targetNode.id, {
      activeConnections: (targetNode.metrics.activeConnections || 0) + 1,
    });

    return response;
  } catch (error) {
    logger.error('Request proxy failed', {
      targetNode: targetNode.id,
      url: url.toString(),
      error: error.message
    });
    throw error;
  }
}
import crypto from 'crypto';
import { EVENT_TYPES, SystemEvent, OrderStatusWebhook, WorkerStatusWebhook, WebhookEvent } from './types';
import { eventBus } from './emitter';
import { logger } from '../../utils/logger';

export interface WebhookConfig {
  url: string;
  secret: string;
  events: EVENT_TYPES[];
  retryAttempts: number;
  retryDelay: number;
  timeout: number;
}

export class WebhookManager {
  private webhooks: WebhookConfig[] = [];
  private webhookQueue: WebhookEvent[] = [];
  private isProcessing = false;
  private maxRetries = 5;
  private retryDelay = 1000; // 1 second base delay

  constructor() {
    this.setupEventListeners();
    this.startWebhookProcessor();
  }

  /**
   * Register a webhook endpoint
   */
  registerWebhook(config: WebhookConfig): string {
    const id = `wh_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.webhooks.push({ ...config, id });

    logger.info(`🔗 Webhook registered: ${config.url}`, {
      events: config.events,
      id
    });

    return id;
  }

  /**
   * Unregister a webhook
   */
  unregisterWebhook(webhookId: string): boolean {
    const index = this.webhooks.findIndex(wh => wh.id === webhookId);
    if (index > -1) {
      this.webhooks.splice(index, 1);
      logger.info(`🔗 Webhook unregistered: ${webhookId}`);
      return true;
    }
    return false;
  }

  /**
   * Get all registered webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return [...this.webhooks];
  }

  /**
   * Setup event listeners for order and worker events
   */
  private setupEventListeners(): void {
    // Order status events
    eventBus.subscribeMultiple([
      EVENT_TYPES.ORDER_CREATED,
      EVENT_TYPES.ORDER_PAYMENT_PROCESSING,
      EVENT_TYPES.ORDER_PAYMENT_COMPLETED,
      EVENT_TYPES.ORDER_PAYMENT_FAILED,
      EVENT_TYPES.ORDER_INVENTORY_UPDATED,
      EVENT_TYPES.ORDER_CONFIRMATION_SENT,
      EVENT_TYPES.ORDER_COMPLETED,
      EVENT_TYPES.ORDER_FAILED,
      EVENT_TYPES.ORDER_CANCELLED
    ], this.handleOrderEvent.bind(this), { priority: 10 });

    // Worker/job events
    eventBus.subscribeMultiple([
      EVENT_TYPES.JOB_ENQUEUED,
      EVENT_TYPES.JOB_STARTED,
      EVENT_TYPES.JOB_COMPLETED,
      EVENT_TYPES.JOB_FAILED,
      EVENT_TYPES.JOB_RETRY
    ], this.handleWorkerEvent.bind(this), { priority: 10 });

    logger.info('🎧 Webhook event listeners registered');
  }

  /**
   * Handle order status events
   */
  private async handleOrderEvent(event: SystemEvent): Promise<void> {
    try {
      const orderWebhook = await this.createOrderWebhookPayload(event);
      await this.queueWebhook(orderWebhook, event);
    } catch (error) {
      logger.error('Failed to handle order webhook event:', error);
    }
  }

  /**
   * Handle worker/job events
   */
  private async handleWorkerEvent(event: SystemEvent): Promise<void> {
    try {
      const workerWebhook = await this.createWorkerWebhookPayload(event);
      await this.queueWebhook(workerWebhook, event);
    } catch (error) {
      logger.error('Failed to handle worker webhook event:', error);
    }
  }

  /**
   * Create order webhook payload
   */
  private async createOrderWebhookPayload(event: SystemEvent): Promise<OrderStatusWebhook> {
    // In a real implementation, you'd fetch the complete order data
    // For now, we'll create a mock payload based on the event
    const mockOrderData = await this.getOrderDataFromEvent(event);

    return {
      orderId: mockOrderData.orderId,
      orderNumber: mockOrderData.orderNumber,
      customerId: event.userId || 'unknown',
      status: this.mapEventToOrderStatus(event.type),
      statusChangedAt: event.timestamp,
      total: mockOrderData.total,
      currency: 'USD',
      items: mockOrderData.items,
      metadata: {
        eventId: event.id,
        correlationId: event.correlationId,
        source: event.source
      }
    };
  }

  /**
   * Create worker webhook payload
   */
  private createWorkerWebhookPayload(event: SystemEvent): WorkerStatusWebhook {
    const status = this.mapEventToWorkerStatus(event.type);

    return {
      workerId: event.metadata?.workerId || 'unknown',
      queueName: event.metadata?.queueName || 'unknown',
      jobId: event.metadata?.jobId || 'unknown',
      jobType: event.metadata?.jobType || 'unknown',
      status,
      startedAt: event.metadata?.startedAt,
      completedAt: event.metadata?.completedAt,
      failedAt: event.metadata?.failedAt,
      processingTime: event.metadata?.processingTime,
      error: event.metadata?.error,
      retryCount: event.metadata?.retryCount,
      nextRetryAt: event.metadata?.nextRetryAt,
      metadata: {
        eventId: event.id,
        correlationId: event.correlationId
      }
    };
  }

  /**
   * Queue webhook for delivery
   */
  private async queueWebhook(payload: OrderStatusWebhook | WorkerStatusWebhook, event: SystemEvent): Promise<void> {
    const relevantWebhooks = this.webhooks.filter(wh => wh.events.includes(event.type));

    for (const webhook of relevantWebhooks) {
      const webhookEvent: WebhookEvent = {
        id: `wh_evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
        event: event.type,
        created: new Date(),
        data: payload,
        webhookUrl: webhook.url,
        retryCount: 0,
        status: 'pending'
      };

      this.webhookQueue.push(webhookEvent);
      logger.info(`📤 Webhook queued for ${webhook.url}`, {
        event: event.type,
        webhookId: webhookEvent.id
      });
    }
  }

  /**
   * Start webhook processing worker
   */
  private startWebhookProcessor(): void {
    setInterval(async () => {
      if (this.isProcessing || this.webhookQueue.length === 0) return;

      this.isProcessing = true;

      try {
        await this.processWebhookQueue();
      } catch (error) {
        logger.error('Webhook processing error:', error);
      } finally {
        this.isProcessing = false;
      }
    }, 1000); // Process every second

    logger.info('🔄 Webhook processor started');
  }

  /**
   * Process queued webhooks
   */
  private async processWebhookQueue(): Promise<void> {
    const pendingWebhooks = this.webhookQueue.filter(wh => wh.status === 'pending');

    for (const webhookEvent of pendingWebhooks) {
      try {
        await this.deliverWebhook(webhookEvent);
      } catch (error) {
        logger.error(`Webhook delivery failed for ${webhookEvent.webhookUrl}:`, error);

        webhookEvent.retryCount = (webhookEvent.retryCount || 0) + 1;
        webhookEvent.lastAttempt = new Date();

        if (webhookEvent.retryCount >= this.maxRetries) {
          webhookEvent.status = 'failed';
          webhookEvent.error = error.message;
          logger.error(`Webhook permanently failed after ${webhookEvent.retryCount} attempts`);
        } else {
          // Exponential backoff
          const delay = this.retryDelay * Math.pow(2, webhookEvent.retryCount - 1);
          setTimeout(() => {
            // Retry will happen on next processing cycle
          }, delay);
        }
      }
    }

    // Clean up delivered/failed webhooks (keep only recent ones)
    this.webhookQueue = this.webhookQueue.filter(wh =>
      wh.status === 'pending' || (Date.now() - wh.created.getTime()) < 3600000 // Keep for 1 hour
    );
  }

  /**
   * Deliver webhook to endpoint
   */
  private async deliverWebhook(webhookEvent: WebhookEvent): Promise<void> {
    if (!webhookEvent.webhookUrl) return;

    const webhook = this.webhooks.find(wh => wh.url === webhookEvent.webhookUrl);
    if (!webhook) return;

    const payload = {
      id: webhookEvent.id,
      event: webhookEvent.event,
      created: webhookEvent.created.toISOString(),
      data: webhookEvent.data
    };

    // Create signature
    const signature = this.createWebhookSignature(JSON.stringify(payload), webhook.secret);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), webhook.timeout);

    try {
      const response = await fetch(webhookEvent.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': webhookEvent.event,
          'X-Webhook-ID': webhookEvent.id,
          'User-Agent': 'Ecommerce-Webhook/1.0'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        webhookEvent.status = 'delivered';
        webhookEvent.response = {
          status: response.status,
          statusText: response.statusText
        };
        logger.info(`✅ Webhook delivered to ${webhookEvent.webhookUrl}`);
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Webhook timeout');
      }

      throw error;
    }
  }

  /**
   * Create webhook signature for security
   */
  private createWebhookSignature(payload: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(payload, 'utf8')
      .digest('hex');
  }

  /**
   * Verify webhook signature (for incoming webhooks)
   */
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    try {
      const expectedSignature = this.createWebhookSignature(payload, secret);
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Get order data from event (mock implementation)
   */
  private async getOrderDataFromEvent(event: SystemEvent): Promise<any> {
    // In a real implementation, this would query the database
    // For demo purposes, return mock data
    return {
      orderId: event.metadata?.orderId || 'unknown',
      orderNumber: event.metadata?.orderNumber || 1,
      total: event.metadata?.total || '0.00',
      items: event.metadata?.items || []
    };
  }

  /**
   * Map event type to order status
   */
  private mapEventToOrderStatus(eventType: EVENT_TYPES): string {
    const statusMap: Record<string, string> = {
      [EVENT_TYPES.ORDER_CREATED]: 'created',
      [EVENT_TYPES.ORDER_PAYMENT_PROCESSING]: 'payment_processing',
      [EVENT_TYPES.ORDER_PAYMENT_COMPLETED]: 'paid',
      [EVENT_TYPES.ORDER_PAYMENT_FAILED]: 'payment_failed',
      [EVENT_TYPES.ORDER_INVENTORY_UPDATED]: 'inventory_updated',
      [EVENT_TYPES.ORDER_CONFIRMATION_SENT]: 'confirmation_sent',
      [EVENT_TYPES.ORDER_COMPLETED]: 'completed',
      [EVENT_TYPES.ORDER_FAILED]: 'failed',
      [EVENT_TYPES.ORDER_CANCELLED]: 'cancelled'
    };

    return statusMap[eventType] || 'unknown';
  }

  /**
   * Map event type to worker status
   */
  private mapEventToWorkerStatus(eventType: EVENT_TYPES): 'started' | 'completed' | 'failed' | 'retry' {
    const statusMap: Record<string, 'started' | 'completed' | 'failed' | 'retry'> = {
      [EVENT_TYPES.JOB_STARTED]: 'started',
      [EVENT_TYPES.JOB_COMPLETED]: 'completed',
      [EVENT_TYPES.JOB_FAILED]: 'failed',
      [EVENT_TYPES.JOB_RETRY]: 'retry'
    };

    return statusMap[eventType] || 'started';
  }

  /**
   * Get webhook statistics
   */
  getStats(): {
    registeredWebhooks: number;
    queuedWebhooks: number;
    deliveredWebhooks: number;
    failedWebhooks: number;
  } {
    const queued = this.webhookQueue.filter(wh => wh.status === 'pending').length;
    const delivered = this.webhookQueue.filter(wh => wh.status === 'delivered').length;
    const failed = this.webhookQueue.filter(wh => wh.status === 'failed').length;

    return {
      registeredWebhooks: this.webhooks.length,
      queuedWebhooks: queued,
      deliveredWebhooks: delivered,
      failedWebhooks: failed
    };
  }
}

// Export singleton instance
export const webhookManager = new WebhookManager();
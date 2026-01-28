import { SystemEvent, EVENT_TYPES } from '../events/types';
import { eventBus, createEvent, emitEvent } from '../events/emitter';
import { jobProducer } from './producer';
import { logger } from '../../utils/logger';

/**
 * Event-driven job handlers
 * These listen to system events and enqueue appropriate jobs
 */

export class EventDrivenJobHandlers {
  constructor() {
    this.registerEventHandlers();
  }

  private registerEventHandlers(): void {
    // Order Events → Job Enqueueing
    eventBus.subscribe(EVENT_TYPES.ORDER_CHECKOUT_INITIATED, this.handleOrderCheckoutInitiated.bind(this));
    eventBus.subscribe(EVENT_TYPES.ORDER_CREATED, this.handleOrderCreated.bind(this));
    eventBus.subscribe(EVENT_TYPES.ORDER_PAYMENT_PROCESSING, this.handleOrderPaymentProcessing.bind(this));

    // Cart Events → Job Enqueueing
    eventBus.subscribe(EVENT_TYPES.CART_ABANDONED, this.handleCartAbandoned.bind(this));

    // Job Events → Monitoring/Logging
    eventBus.subscribe(EVENT_TYPES.JOB_ENQUEUED, this.handleJobEnqueued.bind(this));
    eventBus.subscribe(EVENT_TYPES.JOB_STARTED, this.handleJobStarted.bind(this));
    eventBus.subscribe(EVENT_TYPES.JOB_COMPLETED, this.handleJobCompleted.bind(this));
    eventBus.subscribe(EVENT_TYPES.JOB_FAILED, this.handleJobFailed.bind(this));

    logger.info('🎧 Event-driven job handlers registered');
  }

  /**
   * Handle order checkout initiated event
   */
  private async handleOrderCheckoutInitiated(event: SystemEvent): Promise<void> {
    try {
      logger.info(`🛒 Processing checkout for customer ${event.userId}`);

      // Enqueue order creation job
      const job = await jobProducer.enqueueOrderCreation({
        checkoutInput: event.data.checkoutInput,
        sessionId: event.sessionId,
        userAgent: event.data.userAgent,
        ipAddress: event.data.ipAddress
      });

      // Emit job enqueued event
      await emitEvent(createEvent(EVENT_TYPES.JOB_ENQUEUED, {
        jobId: job.id,
        jobType: 'order-creation',
        queueName: 'order-processing',
        priority: 5
      }, {
        correlationId: event.correlationId,
        userId: event.userId,
        sessionId: event.sessionId
      }));

    } catch (error) {
      logger.error('Failed to handle order checkout initiated:', error);

      // Emit order failed event
      await emitEvent(createEvent(EVENT_TYPES.ORDER_FAILED, {
        orderId: 'pending',
        reason: 'checkout_initiation_failed',
        error: error.message
      }, {
        correlationId: event.correlationId,
        userId: event.userId,
        sessionId: event.sessionId
      }));
    }
  }

  /**
   * Handle order created event
   */
  private async handleOrderCreated(event: SystemEvent): Promise<void> {
    try {
      const { orderId, customerId } = event.data;

      logger.info(`📦 Order ${orderId} created, enqueuing dependent jobs`);

      // Enqueue payment processing job
      const paymentJob = await jobProducer.enqueuePaymentProcessing({
        orderId,
        amount: parseFloat(event.data.total),
        currency: 'USD',
        customerId,
        idempotencyKey: `payment_${orderId}_${Date.now()}`
      });

      // Emit payment processing event
      await emitEvent(createEvent(EVENT_TYPES.ORDER_PAYMENT_PROCESSING, {
        orderId,
        paymentId: `payment_${orderId}`,
        amount: parseFloat(event.data.total),
        currency: 'USD'
      }, {
        correlationId: event.correlationId,
        userId: customerId
      }));

      // Emit job enqueued event for payment
      await emitEvent(createEvent(EVENT_TYPES.JOB_ENQUEUED, {
        jobId: paymentJob.id,
        jobType: 'payment-processing',
        queueName: 'payment-processing',
        priority: 1
      }, {
        correlationId: event.correlationId,
        userId: customerId
      }));

    } catch (error) {
      logger.error(`Failed to handle order created for ${event.data.orderId}:`, error);
    }
  }

  /**
   * Handle order payment processing event
   */
  private async handleOrderPaymentProcessing(event: SystemEvent): Promise<void> {
    try {
      const { orderId } = event.data;

      // This could trigger additional jobs like fraud checking, etc.
      logger.info(`💳 Payment processing started for order ${orderId}`);

      // In a real system, you might enqueue fraud detection jobs here
      // For now, we'll just log the event

    } catch (error) {
      logger.error(`Failed to handle payment processing for ${event.data.orderId}:`, error);
    }
  }

  /**
   * Handle cart abandoned event
   */
  private async handleCartAbandoned(event: SystemEvent): Promise<void> {
    try {
      const { customerId, customerEmail, cartItems, totalValue } = event.data;

      logger.info(`🛒 Cart abandoned by customer ${customerId}, enqueuing recovery job`);

      // Enqueue cart abandonment email job
      const recoveryJob = await jobProducer.enqueueCartAbandonmentProcessing({
        customerId,
        customerEmail,
        recoveryToken: `recovery_${customerId}_${Date.now()}`,
        cartItems,
        totalValue,
        reminderType: 'first' // First reminder
      });

      // Emit job enqueued event
      await emitEvent(createEvent(EVENT_TYPES.JOB_ENQUEUED, {
        jobId: recoveryJob.id,
        jobType: 'cart-recovery-email',
        queueName: 'cart-abandonment',
        priority: 10
      }, {
        correlationId: event.correlationId,
        userId: customerId
      }));

    } catch (error) {
      logger.error(`Failed to handle cart abandonment for ${event.data.customerId}:`, error);
    }
  }

  /**
   * Handle job enqueued event (for monitoring)
   */
  private async handleJobEnqueued(event: SystemEvent): Promise<void> {
    const { jobId, jobType, queueName, priority } = event.data;

    logger.info(`📋 Job enqueued: ${jobType} (${jobId}) in ${queueName}`, {
      priority,
      correlationId: event.correlationId,
      userId: event.userId
    });

    // Here you could store job metrics, update dashboards, etc.
  }

  /**
   * Handle job started event
   */
  private async handleJobStarted(event: SystemEvent): Promise<void> {
    const { jobId, jobType, workerId } = event.data;

    logger.info(`▶️ Job started: ${jobType} (${jobId}) by worker ${workerId}`);

    // Track job processing metrics
    // Update real-time dashboards
    // Send notifications if needed
  }

  /**
   * Handle job completed event
   */
  private async handleJobCompleted(event: SystemEvent): Promise<void> {
    const { jobId, jobType, result, processingTime } = event.data;

    logger.info(`✅ Job completed: ${jobType} (${jobId}) in ${processingTime}ms`, {
      result: typeof result === 'object' ? JSON.stringify(result) : result
    });

    // Process job results
    await this.processJobResult(event);

    // Update metrics
    // Send success notifications
    // Trigger dependent jobs if needed
  }

  /**
   * Handle job failed event
   */
  private async handleJobFailed(event: SystemEvent): Promise<void> {
    const { jobId, jobType, error, attemptsMade } = event.data;

    logger.error(`❌ Job failed: ${jobType} (${jobId}) after ${attemptsMade} attempts`, {
      error,
      correlationId: event.correlationId,
      userId: event.userId
    });

    // Handle job failures
    await this.processJobFailure(event);

    // Send alerts for critical job failures
    if (this.isCriticalJob(jobType)) {
      await this.sendJobFailureAlert(event);
    }
  }

  /**
   * Process job results and trigger follow-up actions
   */
  private async processJobResult(event: SystemEvent): Promise<void> {
    const { jobType, result } = event.data;

    switch (jobType) {
      case 'order-creation':
        if (result.success) {
          // Emit order created event
          await emitEvent(createEvent(EVENT_TYPES.ORDER_CREATED, {
            orderId: result.data.orderId,
            orderNumber: result.data.orderNumber,
            customerId: result.data.customerId,
            total: result.data.total,
            items: result.data.items
          }, {
            correlationId: event.correlationId,
            userId: result.data.customerId
          }));
        }
        break;

      case 'payment-processing':
        if (result.success) {
          // Emit payment completed event
          await emitEvent(createEvent(EVENT_TYPES.ORDER_PAYMENT_COMPLETED, {
            orderId: result.orderId,
            paymentId: result.gatewayId,
            transactionId: result.transactionId,
            amount: result.amount,
            currency: result.currency
          }, {
            correlationId: event.correlationId,
            userId: result.customerId
          }));

          // Enqueue inventory update job
          await jobProducer.enqueueInventoryUpdate({
            orderId: result.orderId,
            items: result.items || []
          });
        } else {
          // Emit payment failed event
          await emitEvent(createEvent(EVENT_TYPES.ORDER_PAYMENT_FAILED, {
            orderId: result.orderId,
            reason: result.error,
            amount: result.amount
          }, {
            correlationId: event.correlationId,
            userId: result.customerId
          }));
        }
        break;

      case 'inventory-update':
        if (result.success) {
          // Emit inventory updated event
          await emitEvent(createEvent(EVENT_TYPES.ORDER_INVENTORY_UPDATED, {
            orderId: result.orderId,
            items: result.updatedItems
          }, {
            correlationId: event.correlationId
          }));

          // Enqueue order confirmation email
          const orderData = await this.getOrderData(result.orderId);
          if (orderData) {
            await jobProducer.enqueueOrderConfirmation({
              orderId: result.orderId,
              customerId: orderData.customerId,
              customerEmail: orderData.customerEmail,
              orderDetails: {
                total: orderData.total,
                itemCount: orderData.items.length,
                items: orderData.items
              }
            });
          }
        }
        break;

      case 'order-confirmation':
        if (result.success) {
          // Emit order confirmation sent event
          await emitEvent(createEvent(EVENT_TYPES.ORDER_CONFIRMATION_SENT, {
            orderId: result.orderId,
            emailId: result.emailId,
            sentAt: new Date()
          }, {
            correlationId: event.correlationId
          }));

          // Emit order completed event
          await emitEvent(createEvent(EVENT_TYPES.ORDER_COMPLETED, {
            orderId: result.orderId,
            completedAt: new Date()
          }, {
            correlationId: event.correlationId
          }));
        }
        break;

      case 'cart-recovery-email':
        // Handle cart recovery email results
        logger.info(`📧 Cart recovery email sent for ${result.customerId}`);
        break;
    }
  }

  /**
   * Process job failures and handle retries/cleanup
   */
  private async processJobFailure(event: SystemEvent): Promise<void> {
    const { jobType, error, attemptsMade, nextRetryAt } = event.data;

    // Log failure details
    logger.error(`Job failure details:`, {
      jobType,
      error,
      attemptsMade,
      nextRetryAt,
      correlationId: event.correlationId,
      userId: event.userId
    });

    // Handle specific failure scenarios
    switch (jobType) {
      case 'payment-processing':
        // Payment failures might need manual intervention
        await this.handlePaymentFailure(event);
        break;

      case 'order-creation':
        // Order creation failures are critical
        await this.handleOrderCreationFailure(event);
        break;

      case 'inventory-update':
        // Inventory failures might need rollback
        await this.handleInventoryFailure(event);
        break;
    }
  }

  /**
   * Send alerts for critical job failures
   */
  private async sendJobFailureAlert(event: SystemEvent): Promise<void> {
    const { jobType, jobId, error } = event.data;

    // In a real system, this would send alerts to monitoring systems
    // Email, Slack, PagerDuty, etc.
    logger.error(`🚨 CRITICAL JOB FAILURE ALERT 🚨`, {
      jobType,
      jobId,
      error,
      timestamp: event.timestamp,
      correlationId: event.correlationId
    });
  }

  /**
   * Check if job type is critical
   */
  private isCriticalJob(jobType: string): boolean {
    const criticalJobs = ['order-creation', 'payment-processing'];
    return criticalJobs.includes(jobType);
  }

  /**
   * Handle payment failure scenarios
   */
  private async handlePaymentFailure(event: SystemEvent): Promise<void> {
    // Implement payment failure recovery logic
    // Could include: retry with different payment method, manual review, etc.
    logger.warn(`Payment failure handling for job ${event.data.jobId}`);
  }

  /**
   * Handle order creation failure scenarios
   */
  private async handleOrderCreationFailure(event: SystemEvent): Promise<void> {
    // Critical failure - might need to notify customer support
    logger.error(`Order creation failure - requires manual intervention for job ${event.data.jobId}`);
  }

  /**
   * Handle inventory update failure scenarios
   */
  private async handleInventoryFailure(event: SystemEvent): Promise<void> {
    // Inventory failures might require stock reconciliation
    logger.warn(`Inventory update failure for job ${event.data.jobId} - stock may be inconsistent`);
  }

  /**
   * Get order data (helper method)
   */
  private async getOrderData(orderId: string): Promise<any> {
    // In a real implementation, this would query the database
    // For demo purposes, return mock data
    return {
      customerId: 'mock-customer',
      customerEmail: 'customer@example.com',
      total: '99.99',
      items: []
    };
  }
}

// Export singleton instance
export const eventDrivenJobHandlers = new EventDrivenJobHandlers();
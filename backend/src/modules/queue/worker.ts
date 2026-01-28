import { Worker, Job } from 'bullmq';
import { redisConfig, QUEUES, JOB_TYPES } from './config';
import type { JobData, JobResult } from './types';

// Import services
import { checkout } from '../order/service';
import { paymentService } from '../payment/service';
import { cartSessionManager } from '../cart-persistence/service';
import { emailService } from '../email/service';

export class QueueWorker {
  private workers: Map<string, Worker> = new Map();

  constructor() {
    this.initializeWorkers();
  }

  private initializeWorkers() {
    // Order Processing Worker
    this.createWorker(
      QUEUES.ORDER_PROCESSING,
      async (job: Job<JobData>) => {
        return await this.processOrderJob(job);
      },
      2 // 2 concurrent jobs
    );

    // Payment Processing Worker
    this.createWorker(
      QUEUES.PAYMENT_PROCESSING,
      async (job: Job<JobData>) => {
        return await this.processPaymentJob(job);
      },
      3 // 3 concurrent jobs for payments
    );

    // Email Notifications Worker
    this.createWorker(
      QUEUES.EMAIL_NOTIFICATIONS,
      async (job: Job<JobData>) => {
        return await this.processEmailJob(job);
      },
      5 // 5 concurrent email jobs
    );

    // Cart Abandonment Worker
    this.createWorker(
      QUEUES.CART_ABANDONMENT,
      async (job: Job<JobData>) => {
        return await this.processCartAbandonmentJob(job);
      },
      2 // 2 concurrent cart jobs
    );

    // Inventory Updates Worker
    this.createWorker(
      QUEUES.INVENTORY_UPDATES,
      async (job: Job<JobData>) => {
        return await this.processInventoryJob(job);
      },
      2 // 2 concurrent inventory jobs
    );
  }

  private createWorker(queueName: string, processor: (job: Job<JobData>) => Promise<JobResult>, concurrency: number = 1) {
    const worker = new Worker(
      queueName,
      async (job) => {
        const startTime = Date.now();

        try {
          console.log(`🔄 Processing job ${job.id} (${job.name}) in queue ${queueName}`);

          const result = await processor(job);
          result.processingTime = Date.now() - startTime;

          console.log(`✅ Job ${job.id} completed in ${result.processingTime}ms`);

          return result;
        } catch (error: any) {
          const processingTime = Date.now() - startTime;
          console.error(`❌ Job ${job.id} failed after ${processingTime}ms:`, error.message);

          throw {
            success: false,
            error: error.message,
            processingTime,
            retryCount: job.attemptsMade,
          };
        }
      },
      {
        connection: redisConfig,
        concurrency,
        limiter: {
          max: 1000, // Max jobs per duration
          duration: 60000, // Per minute
        },
        removeOnComplete: 50,
        removeOnFail: 100,
      }
    );

    // Event listeners for monitoring
    worker.on('completed', (job) => {
      console.log(`✅ Job ${job.id} completed successfully`);
    });

    worker.on('failed', (job, err) => {
      console.error(`❌ Job ${job.id} failed:`, err.message);
    });

    worker.on('stalled', (jobId) => {
      console.warn(`⚠️ Job ${jobId} stalled`);
    });

    this.workers.set(queueName, worker);
  }

  // Job processors
  private async processOrderJob(job: Job<JobData>): Promise<JobResult> {
    const { name, data } = job;

    switch (name) {
      case JOB_TYPES.CREATE_ORDER: {
        const startTime = Date.now();
        const result = await checkout(data.checkoutInput);
        return {
          success: true,
          data: {
            orderId: result.id,
            orderNumber: result.orderNumber,
          },
          processingTime: Date.now() - startTime,
        };
      }

      case JOB_TYPES.GENERATE_DISCOUNT_CODE: {
        // Import here to avoid circular dependencies
        const { checkAndGenerateDiscountCode } = await import('../discount/service');

        await checkAndGenerateDiscountCode(data.customerId);
        return {
          success: true,
          data: { message: 'Discount code generation completed' },
        };
      }

      default:
        throw new Error(`Unknown order job type: ${name}`);
    }
  }

  private async processPaymentJob(job: Job<JobData>): Promise<JobResult> {
    const { name, data } = job;

    switch (name) {
      case JOB_TYPES.PROCESS_PAYMENT: {
        const result = await paymentService.processPayment({
          orderId: data.orderId,
          amount: data.amount,
          currency: data.currency,
          customerId: data.customerId,
          idempotencyKey: data.idempotencyKey,
          paymentMethod: data.paymentMethod,
        });

        return {
          success: result.status === 'completed',
          data: result,
        };
      }

      default:
        throw new Error(`Unknown payment job type: ${name}`);
    }
  }

  private async processEmailJob(job: Job<JobData>): Promise<JobResult> {
    const { name, data } = job;

    switch (name) {
      case JOB_TYPES.SEND_ORDER_CONFIRMATION: {
        // In a real implementation, this would integrate with an email service
        // For now, we'll simulate email sending
        console.log(`📧 Sending order confirmation to ${data.customerEmail} for order ${data.orderId}`);

        // Simulate email sending delay
        await new Promise(resolve => setTimeout(resolve, 100));

        return {
          success: true,
          data: {
            emailId: `email_${Date.now()}`,
            recipient: data.customerEmail,
            type: 'order_confirmation',
          },
        };
      }

      default:
        throw new Error(`Unknown email job type: ${name}`);
    }
  }

  private async processCartAbandonmentJob(job: Job<JobData>): Promise<JobResult> {
    const { name, data } = job;

    switch (name) {
      case JOB_TYPES.SEND_RECOVERY_EMAIL: {
        const success = await emailService.sendCartAbandonmentEmail(
          {
            customerId: data.customerId,
            customerEmail: data.customerEmail,
            cartItems: data.cartItems,
            lastActivity: new Date(), // Would be passed in real data
            totalValue: data.totalValue,
          },
          data.recoveryToken,
          data.reminderType
        );

        return {
          success,
          data: {
            customerId: data.customerId,
            reminderType: data.reminderType,
            emailSent: success,
          },
        };
      }

      case JOB_TYPES.CLEANUP_EXPIRED_SESSIONS: {
        const cleanedCount = await cartSessionManager.cleanupExpiredSessions();
        return {
          success: true,
          data: {
            sessionsCleaned: cleanedCount,
          },
        };
      }

      case JOB_TYPES.UPDATE_ANALYTICS: {
        // In a real implementation, this would update analytics database
        console.log(`📊 Updating analytics for ${data.date}:`, data.metrics);
        return {
          success: true,
          data: { message: 'Analytics updated' },
        };
      }

      default:
        throw new Error(`Unknown cart abandonment job type: ${name}`);
    }
  }

  private async processInventoryJob(job: Job<JobData>): Promise<JobResult> {
    const { name, data } = job;

    switch (name) {
      case JOB_TYPES.UPDATE_INVENTORY: {
        // In a real implementation, this would update inventory
        // For now, we'll simulate inventory updates
        console.log(`📦 Updating inventory for order ${data.orderId}`);

        // Simulate processing delay
        await new Promise(resolve => setTimeout(resolve, 50));

        return {
          success: true,
          data: {
            orderId: data.orderId,
            itemsUpdated: data.items.length,
          },
        };
      }

      default:
        throw new Error(`Unknown inventory job type: ${name}`);
    }
  }

  // Worker management methods
  async getWorkerStats(queueName: string) {
    const worker = this.workers.get(queueName);
    if (!worker) return null;

    return {
      isRunning: worker.isRunning(),
      // Add more stats as needed
    };
  }

  async getAllWorkerStats() {
    const stats: { [queueName: string]: any } = {};

    for (const [queueName, worker] of this.workers) {
      stats[queueName] = await this.getWorkerStats(queueName);
    }

    return stats;
  }

  // Graceful shutdown
  async close() {
    console.log('Shutting down queue workers...');

    for (const [queueName, worker] of this.workers) {
      console.log(`Closing worker for queue: ${queueName}`);
      await worker.close();
    }

    this.workers.clear();
    console.log('✅ All queue workers shut down');
  }
}

// Export singleton instance
export const queueWorker = new QueueWorker();

// Graceful shutdown handlers
process.on('SIGTERM', async () => {
  await queueWorker.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await queueWorker.close();
  process.exit(0);
});
import { Queue } from 'bullmq';
import { redisConfig, QUEUES, QUEUE_CONFIGS, JOB_TYPES } from './config';
import type {
  CreateOrderJobData,
  ProcessPaymentJobData,
  UpdateInventoryJobData,
  SendOrderConfirmationJobData,
  SendRecoveryEmailJobData,
  GenerateDiscountCodeJobData,
  CleanupExpiredSessionsJobData,
  UpdateAnalyticsJobData,
  JobResult
} from './types';

export class JobProducer {
  private queues: Map<string, Queue> = new Map();

  constructor() {
    this.initializeQueues();
  }

  private initializeQueues() {
    // Initialize all queues
    Object.values(QUEUES).forEach(queueName => {
      const config = QUEUE_CONFIGS[queueName] || { defaultJobOptions: {} };
      const queue = new Queue(queueName, {
        connection: redisConfig,
        defaultJobOptions: config.defaultJobOptions,
      });
      this.queues.set(queueName, queue);
    });
  }

  private getQueue(queueName: string): Queue {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }
    return queue;
  }

  // Order processing jobs
  async enqueueOrderCreation(data: CreateOrderJobData, delayMs: number = 0) {
    const queue = this.getQueue(QUEUES.ORDER_PROCESSING);
    const job = await queue.add(
      JOB_TYPES.CREATE_ORDER,
      data,
      {
        delay: delayMs,
        jobId: `order_${data.checkoutInput.customerId}_${Date.now()}`,
      }
    );
    return job;
  }

  async enqueuePaymentProcessing(data: ProcessPaymentJobData) {
    const queue = this.getQueue(QUEUES.PAYMENT_PROCESSING);
    const job = await queue.add(
      JOB_TYPES.PROCESS_PAYMENT,
      data,
      {
        jobId: `payment_${data.orderId}_${Date.now()}`,
        priority: 1, // High priority for payments
      }
    );
    return job;
  }

  async enqueueInventoryUpdate(data: UpdateInventoryJobData) {
    const queue = this.getQueue(QUEUES.INVENTORY_UPDATES);
    const job = await queue.add(
      JOB_TYPES.UPDATE_INVENTORY,
      data,
      {
        jobId: `inventory_${data.orderId}_${Date.now()}`,
      }
    );
    return job;
  }

  async enqueueOrderConfirmation(data: SendOrderConfirmationJobData) {
    const queue = this.getQueue(QUEUES.EMAIL_NOTIFICATIONS);
    const job = await queue.add(
      JOB_TYPES.SEND_ORDER_CONFIRMATION,
      data,
      {
        jobId: `confirmation_${data.orderId}_${Date.now()}`,
      }
    );
    return job;
  }

  async enqueueDiscountCodeGeneration(data: GenerateDiscountCodeJobData) {
    const queue = this.getQueue(QUEUES.ORDER_PROCESSING);
    const job = await queue.add(
      JOB_TYPES.GENERATE_DISCOUNT_CODE,
      data,
      {
        jobId: `discount_${data.customerId}_${Date.now()}`,
        delay: 5000, // Small delay to ensure order is fully processed
      }
    );
    return job;
  }

  // Cart abandonment jobs
  async enqueueCartAbandonmentProcessing(data: SendRecoveryEmailJobData) {
    const queue = this.getQueue(QUEUES.CART_ABANDONMENT);
    const job = await queue.add(
      JOB_TYPES.SEND_RECOVERY_EMAIL,
      data,
      {
        jobId: `recovery_${data.customerId}_${data.reminderType}_${Date.now()}`,
      }
    );
    return job;
  }

  async enqueueSessionCleanup(data: CleanupExpiredSessionsJobData = {}) {
    const queue = this.getQueue(QUEUES.CART_ABANDONMENT);
    const job = await queue.add(
      JOB_TYPES.CLEANUP_EXPIRED_SESSIONS,
      data,
      {
        jobId: `cleanup_sessions_${Date.now()}`,
        // Run once per day
        repeat: {
          cron: '0 2 * * *', // Daily at 2 AM
        },
      }
    );
    return job;
  }

  // Analytics and maintenance jobs
  async enqueueAnalyticsUpdate(data: UpdateAnalyticsJobData) {
    const queue = this.getQueue(QUEUES.CART_ABANDONMENT);
    const job = await queue.add(
      JOB_TYPES.UPDATE_ANALYTICS,
      data,
      {
        jobId: `analytics_${data.date}_${Date.now()}`,
        priority: 20, // Low priority
      }
    );
    return job;
  }

  // Job management methods
  async getJobStatus(queueName: string, jobId: string) {
    const queue = this.getQueue(queueName);
    const job = await queue.getJob(jobId);
    return job ? {
      id: job.id,
      name: job.name,
      data: job.data,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      failedReason: job.failedReason,
      returnvalue: job.returnvalue,
      opts: job.opts,
    } : null;
  }

  async getQueueStats(queueName: string) {
    const queue = this.getQueue(queueName);
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    return {
      waiting: waiting.length,
      active: active.length,
      completed: completed.length,
      failed: failed.length,
      delayed: delayed.length,
      total: waiting.length + active.length + completed.length + failed.length + delayed.length,
    };
  }

  async getAllQueueStats() {
    const stats: { [queueName: string]: any } = {};

    for (const queueName of Object.values(QUEUES)) {
      stats[queueName] = await this.getQueueStats(queueName);
    }

    return stats;
  }

  // Cleanup method
  async close() {
    for (const queue of this.queues.values()) {
      await queue.close();
    }
    this.queues.clear();
  }

  // Emergency cleanup - remove all jobs from a queue
  async emergencyCleanup(queueName: string) {
    const queue = this.getQueue(queueName);
    await queue.obliterate({ force: true });
    console.log(`Emergency cleanup completed for queue: ${queueName}`);
  }
}

// Export singleton instance
export const jobProducer = new JobProducer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down job producer...');
  await jobProducer.close();
});

process.on('SIGINT', async () => {
  console.log('Shutting down job producer...');
  await jobProducer.close();
});
import { cartSessionManager, cartRecoveryManager } from "../cart-persistence/service";
import { emailService } from "../email/service";

export class BackgroundJobScheduler {
  private jobs: Map<string, NodeJS.Timeout> = new Map();
  private isRunning = false;

  /**
   * Start all background jobs
   */
  start(): void {
    if (this.isRunning) return;

    console.log('🚀 Starting background job scheduler...');
    this.isRunning = true;

    // Cart session cleanup - every 6 hours
    this.scheduleJob('cart-session-cleanup', () => this.cleanupExpiredSessions(), 6 * 60 * 60 * 1000);

    // Cart abandonment email processing - every hour
    this.scheduleJob('cart-abandonment-emails', () => this.processCartAbandonmentEmails(), 60 * 60 * 1000);

    // Recovery token cleanup - every 24 hours
    this.scheduleJob('recovery-token-cleanup', () => this.cleanupExpiredRecoveries(), 24 * 60 * 60 * 1000);

    // Cart recovery stats logging - every 12 hours
    this.scheduleJob('recovery-stats-logging', () => this.logRecoveryStats(), 12 * 60 * 60 * 1000);

    console.log('✅ Background job scheduler started');
  }

  /**
   * Stop all background jobs
   */
  stop(): void {
    if (!this.isRunning) return;

    console.log('🛑 Stopping background job scheduler...');
    this.isRunning = false;

    for (const [jobName, timeoutId] of this.jobs) {
      clearTimeout(timeoutId);
      console.log(`🛑 Stopped job: ${jobName}`);
    }

    this.jobs.clear();
    console.log('✅ Background job scheduler stopped');
  }

  /**
   * Schedule a recurring job
   */
  private scheduleJob(jobName: string, jobFunction: () => Promise<void>, intervalMs: number): void {
    const runJob = async () => {
      try {
        console.log(`🔄 Running job: ${jobName}`);
        await jobFunction();
        console.log(`✅ Job completed: ${jobName}`);
      } catch (error) {
        console.error(`❌ Job failed: ${jobName}`, error);
      }

      // Schedule next run
      if (this.isRunning) {
        const timeoutId = setTimeout(runJob, intervalMs);
        this.jobs.set(jobName, timeoutId);
      }
    };

    // Start the job immediately, then schedule recurring
    runJob();
  }

  /**
   * Cleanup expired cart sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    try {
      const cleanedCount = await cartSessionManager.cleanupExpiredSessions();
      console.log(`🧹 Cleaned up ${cleanedCount} expired cart sessions`);
    } catch (error) {
      console.error('Failed to cleanup expired sessions:', error);
    }
  }

  /**
   * Process cart abandonment emails
   */
  private async processCartAbandonmentEmails(): Promise<void> {
    try {
      await emailService.processCartAbandonmentEmails();
    } catch (error) {
      console.error('Failed to process cart abandonment emails:', error);
    }
  }

  /**
   * Cleanup expired recovery tokens
   */
  private async cleanupExpiredRecoveries(): Promise<void> {
    try {
      const cleanedCount = await cartRecoveryManager.cleanupExpiredRecoveries();
      console.log(`🧹 Cleaned up ${cleanedCount} expired recovery tokens`);
    } catch (error) {
      console.error('Failed to cleanup expired recoveries:', error);
    }
  }

  /**
   * Log recovery statistics
   */
  private async logRecoveryStats(): Promise<void> {
    try {
      const stats = await cartRecoveryManager.getRecoveryStats();
      console.log('📊 Cart Recovery Statistics:');
      console.log(`   Total recoveries created: ${stats.totalRecoveries}`);
      console.log(`   Successful recoveries: ${stats.successfulRecoveries}`);
      console.log(`   Pending recoveries: ${stats.pendingRecoveries}`);
      console.log(`   Expired recoveries: ${stats.expiredRecoveries}`);

      const successRate = stats.totalRecoveries > 0
        ? ((stats.successfulRecoveries / stats.totalRecoveries) * 100).toFixed(2)
        : '0.00';
      console.log(`   Success rate: ${successRate}%`);
    } catch (error) {
      console.error('Failed to log recovery stats:', error);
    }
  }

  /**
   * Manually trigger a job (for testing/admin purposes)
   */
  async triggerJob(jobName: string): Promise<void> {
    switch (jobName) {
      case 'cart-session-cleanup':
        await this.cleanupExpiredSessions();
        break;
      case 'cart-abandonment-emails':
        await this.processCartAbandonmentEmails();
        break;
      case 'recovery-token-cleanup':
        await this.cleanupExpiredRecoveries();
        break;
      case 'recovery-stats-logging':
        await this.logRecoveryStats();
        break;
      default:
        throw new Error(`Unknown job: ${jobName}`);
    }
  }

  /**
   * Get status of all jobs
   */
  getJobStatus(): { [jobName: string]: boolean } {
    const status: { [jobName: string]: boolean } = {};
    for (const jobName of this.jobs.keys()) {
      status[jobName] = true; // If it exists in the map, it's scheduled
    }
    return status;
  }

  /**
   * Check if scheduler is running
   */
  isSchedulerRunning(): boolean {
    return this.isRunning;
  }
}

// Export singleton instance
export const backgroundJobScheduler = new BackgroundJobScheduler();
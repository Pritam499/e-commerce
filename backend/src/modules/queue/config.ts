import { ConnectionOptions } from 'bullmq';

// Redis connection configuration
export const redisConfig: ConnectionOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB || '0'),
  retryDelayOnFailover: 100,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
  enableReadyCheck: true,
};

// Queue names
export const QUEUES = {
  ORDER_PROCESSING: 'order-processing',
  PAYMENT_PROCESSING: 'payment-processing',
  EMAIL_NOTIFICATIONS: 'email-notifications',
  CART_ABANDONMENT: 'cart-abandonment',
  INVENTORY_UPDATES: 'inventory-updates',
} as const;

// Job types
export enum JOB_TYPES {
  // Order processing jobs
  CREATE_ORDER = 'create-order',
  PROCESS_PAYMENT = 'process-payment',
  UPDATE_INVENTORY = 'update-inventory',
  SEND_ORDER_CONFIRMATION = 'send-order-confirmation',
  GENERATE_DISCOUNT_CODE = 'generate-discount-code',

  // Cart and recovery jobs
  PROCESS_CART_ABANDONMENT = 'process-cart-abandonment',
  SEND_RECOVERY_EMAIL = 'send-recovery-email',
  CLEANUP_EXPIRED_SESSIONS = 'cleanup-expired-sessions',

  // Background maintenance
  CLEANUP_OLD_JOBS = 'cleanup-old-jobs',
  UPDATE_ANALYTICS = 'update-analytics',
}

// Job priorities
export enum JOB_PRIORITIES {
  CRITICAL = 1,    // Payment processing, urgent order creation
  HIGH = 5,        // Order processing, inventory updates
  NORMAL = 10,     // Email notifications, cleanup tasks
  LOW = 20,        // Analytics, maintenance tasks
}

// Job options defaults
export const DEFAULT_JOB_OPTIONS = {
  removeOnComplete: 50,     // Keep last 50 completed jobs
  removeOnFail: 100,        // Keep last 100 failed jobs
  attempts: 3,              // Retry failed jobs 3 times
  backoff: {
    type: 'exponential',
    delay: 2000,            // Start with 2 seconds delay
  },
};

// Queue-specific configurations
export const QUEUE_CONFIGS = {
  [QUEUES.ORDER_PROCESSING]: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      priority: JOB_PRIORITIES.HIGH,
      attempts: 5,          // More retries for critical order processing
    },
  },
  [QUEUES.PAYMENT_PROCESSING]: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      priority: JOB_PRIORITIES.CRITICAL,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,        // Faster retry for payments
      },
    },
  },
  [QUEUES.EMAIL_NOTIFICATIONS]: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      priority: JOB_PRIORITIES.NORMAL,
      attempts: 2,          // Fewer retries for emails
    },
  },
  [QUEUES.CART_ABANDONMENT]: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      priority: JOB_PRIORITIES.LOW,
      attempts: 1,          // Single attempt for cart emails
    },
  },
  [QUEUES.INVENTORY_UPDATES]: {
    defaultJobOptions: {
      ...DEFAULT_JOB_OPTIONS,
      priority: JOB_PRIORITIES.HIGH,
      attempts: 3,
    },
  },
} as const;
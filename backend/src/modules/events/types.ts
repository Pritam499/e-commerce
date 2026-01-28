import { CheckoutInput } from '../order/schema';

// Event Types
export enum EVENT_TYPES {
  // Order Events
  ORDER_CHECKOUT_INITIATED = 'order.checkout.initiated',
  ORDER_CREATED = 'order.created',
  ORDER_PAYMENT_PROCESSING = 'order.payment.processing',
  ORDER_PAYMENT_COMPLETED = 'order.payment.completed',
  ORDER_PAYMENT_FAILED = 'order.payment.failed',
  ORDER_INVENTORY_UPDATED = 'order.inventory.updated',
  ORDER_CONFIRMATION_SENT = 'order.confirmation.sent',
  ORDER_COMPLETED = 'order.completed',
  ORDER_FAILED = 'order.failed',
  ORDER_CANCELLED = 'order.cancelled',

  // Payment Events
  PAYMENT_INITIATED = 'payment.initiated',
  PAYMENT_PROCESSING = 'payment.processing',
  PAYMENT_SUCCEEDED = 'payment.succeeded',
  PAYMENT_FAILED = 'payment.failed',
  PAYMENT_CANCELLED = 'payment.cancelled',
  PAYMENT_REFUNDED = 'payment.refunded',

  // Cart Events
  CART_ITEM_ADDED = 'cart.item.added',
  CART_ITEM_UPDATED = 'cart.item.updated',
  CART_ITEM_REMOVED = 'cart.item.removed',
  CART_CLEARED = 'cart.cleared',
  CART_CHECKOUT_STARTED = 'cart.checkout.started',
  CART_ABANDONED = 'cart.abandoned',
  CART_RECOVERED = 'cart.recovered',

  // Inventory Events
  INVENTORY_LOW_STOCK = 'inventory.low_stock',
  INVENTORY_OUT_OF_STOCK = 'inventory.out_of_stock',
  INVENTORY_RESTOCKED = 'inventory.restocked',

  // Job/Worker Events
  JOB_ENQUEUED = 'job.enqueued',
  JOB_STARTED = 'job.started',
  JOB_COMPLETED = 'job.completed',
  JOB_FAILED = 'job.failed',
  JOB_RETRY = 'job.retry',

  // System Events
  SYSTEM_HEALTH_CHECK = 'system.health_check',
  SYSTEM_MAINTENANCE_STARTED = 'system.maintenance.started',
  SYSTEM_MAINTENANCE_COMPLETED = 'system.maintenance.completed',
}

// Base Event Interface
export interface BaseEvent {
  id: string;
  type: EVENT_TYPES;
  timestamp: Date;
  source: string;
  correlationId?: string;
  userId?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

// Order Events
export interface OrderCheckoutInitiatedEvent extends BaseEvent {
  type: EVENT_TYPES.ORDER_CHECKOUT_INITIATED;
  data: {
    checkoutInput: CheckoutInput;
    userAgent?: string;
    ipAddress?: string;
    sessionId?: string;
  };
}

export interface OrderCreatedEvent extends BaseEvent {
  type: EVENT_TYPES.ORDER_CREATED;
  data: {
    orderId: string;
    orderNumber: number;
    customerId: string;
    total: string;
    items: Array<{
      productId: string;
      quantity: number;
      price: string;
    }>;
  };
}

export interface OrderPaymentProcessingEvent extends BaseEvent {
  type: EVENT_TYPES.ORDER_PAYMENT_PROCESSING;
  data: {
    orderId: string;
    paymentId: string;
    amount: number;
    currency: string;
  };
}

export interface OrderPaymentCompletedEvent extends BaseEvent {
  type: EVENT_TYPES.ORDER_PAYMENT_COMPLETED;
  data: {
    orderId: string;
    paymentId: string;
    transactionId: string;
    amount: number;
    currency: string;
  };
}

export interface OrderInventoryUpdatedEvent extends BaseEvent {
  type: EVENT_TYPES.ORDER_INVENTORY_UPDATED;
  data: {
    orderId: string;
    items: Array<{
      productId: string;
      quantity: number;
      previousStock: number;
      newStock: number;
    }>;
  };
}

// Payment Events
export interface PaymentInitiatedEvent extends BaseEvent {
  type: EVENT_TYPES.PAYMENT_INITIATED;
  data: {
    paymentId: string;
    orderId: string;
    amount: number;
    currency: string;
    method: string;
  };
}

export interface PaymentSucceededEvent extends BaseEvent {
  type: EVENT_TYPES.PAYMENT_SUCCEEDED;
  data: {
    paymentId: string;
    orderId: string;
    transactionId: string;
    amount: number;
    currency: string;
    gatewayResponse: any;
  };
}

// Cart Events
export interface CartItemAddedEvent extends BaseEvent {
  type: EVENT_TYPES.CART_ITEM_ADDED;
  data: {
    customerId: string;
    productId: string;
    quantity: number;
    cartTotal: number;
  };
}

export interface CartItemUpdatedEvent extends BaseEvent {
  type: EVENT_TYPES.CART_ITEM_UPDATED;
  data: {
    customerId: string;
    productId: string;
    quantity: number;
    cartTotal: number;
  };
}

export interface CartItemRemovedEvent extends BaseEvent {
  type: EVENT_TYPES.CART_ITEM_REMOVED;
  data: {
    customerId: string;
    productId: string;
    cartTotal: number;
  };
}

export interface CartClearedEvent extends BaseEvent {
  type: EVENT_TYPES.CART_CLEARED;
  data: {
    customerId: string;
    cartTotal: number;
  };
}

export interface CartAbandonedEvent extends BaseEvent {
  type: EVENT_TYPES.CART_ABANDONED;
  data: {
    customerId: string;
    customerEmail?: string;
    cartItems: any[];
    totalValue: number;
    lastActivity: Date;
    sessionId: string;
  };
}

// Job Events
export interface JobEnqueuedEvent extends BaseEvent {
  type: EVENT_TYPES.JOB_ENQUEUED;
  data: {
    jobId: string;
    jobType: string;
    queueName: string;
    priority: number;
  };
}

export interface JobStartedEvent extends BaseEvent {
  type: EVENT_TYPES.JOB_STARTED;
  data: {
    jobId: string;
    jobType: string;
    workerId: string;
    startedAt: Date;
  };
}

export interface JobCompletedEvent extends BaseEvent {
  type: EVENT_TYPES.JOB_COMPLETED;
  data: {
    jobId: string;
    jobType: string;
    result: any;
    processingTime: number;
    completedAt: Date;
  };
}

export interface JobFailedEvent extends BaseEvent {
  type: EVENT_TYPES.JOB_FAILED;
  data: {
    jobId: string;
    jobType: string;
    error: string;
    attemptsMade: number;
    failedAt: Date;
    nextRetryAt?: Date;
  };
}

// Union type for all events
export type SystemEvent =
  | OrderCheckoutInitiatedEvent
  | OrderCreatedEvent
  | OrderPaymentProcessingEvent
  | OrderPaymentCompletedEvent
  | OrderInventoryUpdatedEvent
  | PaymentInitiatedEvent
  | PaymentSucceededEvent
  | CartItemAddedEvent
  | CartItemUpdatedEvent
  | CartItemRemovedEvent
  | CartClearedEvent
  | CartAbandonedEvent
  | JobEnqueuedEvent
  | JobStartedEvent
  | JobCompletedEvent
  | JobFailedEvent;

// Event Handler Function Type
export type EventHandler<T extends SystemEvent = SystemEvent> = (event: T) => Promise<void> | void;

// Event Subscription
export interface EventSubscription {
  eventType: EVENT_TYPES;
  handler: EventHandler;
  priority?: number; // Higher priority handlers run first
  filter?: (event: SystemEvent) => boolean;
}

// Webhook Event Types
export interface WebhookEvent {
  id: string;
  event: EVENT_TYPES;
  created: Date;
  data: any;
  webhookUrl?: string;
  retryCount?: number;
  lastAttempt?: Date;
  status: 'pending' | 'delivered' | 'failed';
  response?: any;
  error?: string;
}

// Order Status Webhook Payload
export interface OrderStatusWebhook {
  orderId: string;
  orderNumber: number;
  customerId: string;
  status: string;
  statusChangedAt: Date;
  previousStatus?: string;
  total: string;
  currency: string;
  items: Array<{
    productId: string;
    productName: string;
    quantity: number;
    price: string;
  }>;
  shippingAddress?: any;
  paymentInfo?: {
    method: string;
    transactionId?: string;
    status: string;
  };
  metadata?: Record<string, any>;
}

// Worker Status Webhook Payload
export interface WorkerStatusWebhook {
  workerId: string;
  queueName: string;
  jobId: string;
  jobType: string;
  status: 'started' | 'completed' | 'failed' | 'retry';
  startedAt?: Date;
  completedAt?: Date;
  failedAt?: Date;
  processingTime?: number;
  error?: string;
  retryCount?: number;
  nextRetryAt?: Date;
  metadata?: Record<string, any>;
}
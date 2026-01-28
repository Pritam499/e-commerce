import { CheckoutInput } from '../order/schema';

// Job data interfaces
export interface CreateOrderJobData {
  checkoutInput: CheckoutInput;
  sessionId?: string;
  userAgent?: string;
  ipAddress?: string;
}

export interface ProcessPaymentJobData {
  orderId: string;
  amount: number;
  currency: string;
  customerId: string;
  idempotencyKey: string;
  paymentMethod?: string;
}

export interface UpdateInventoryJobData {
  orderId: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: string;
  }>;
}

export interface SendOrderConfirmationJobData {
  orderId: string;
  customerId: string;
  customerEmail: string;
  orderDetails: {
    total: string;
    itemCount: number;
    items: Array<{
      name: string;
      quantity: number;
      price: string;
    }>;
  };
}

export interface SendRecoveryEmailJobData {
  customerId: string;
  customerEmail: string;
  recoveryToken: string;
  cartItems: any[];
  totalValue: number;
  reminderType: 'first' | 'second' | 'final';
}

export interface GenerateDiscountCodeJobData {
  customerId: string;
  reason: 'nth_order' | 'manual';
  orderId?: string;
}

export interface CleanupExpiredSessionsJobData {
  olderThanDays?: number;
}

export interface UpdateAnalyticsJobData {
  date: string;
  metrics: {
    ordersCreated: number;
    revenue: number;
    abandonedCarts: number;
    recoveryEmailsSent: number;
  };
}

// Union type for all job data
export type JobData =
  | CreateOrderJobData
  | ProcessPaymentJobData
  | UpdateInventoryJobData
  | SendOrderConfirmationJobData
  | SendRecoveryEmailJobData
  | GenerateDiscountCodeJobData
  | CleanupExpiredSessionsJobData
  | UpdateAnalyticsJobData;

// Job result interfaces
export interface OrderCreationResult {
  success: boolean;
  orderId?: string;
  error?: string;
  processingTime?: number;
}

export interface PaymentProcessingResult {
  success: boolean;
  gatewayId?: string;
  transactionId?: string;
  error?: string;
}

export interface InventoryUpdateResult {
  success: boolean;
  updatedItems: number;
  error?: string;
}

export interface EmailSendingResult {
  success: boolean;
  emailId?: string;
  error?: string;
}

// Generic job result
export interface JobResult {
  success: boolean;
  data?: any;
  error?: string;
  processingTime?: number;
  retryCount?: number;
}
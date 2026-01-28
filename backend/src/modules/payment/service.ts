import { eq, and, sql } from "drizzle-orm";
import { db } from "../../lib/db";
import { orders, paymentLogs, refundLogs } from "../../drizzle/schema";
import crypto from "crypto";

// Types
export interface PaymentData {
  orderId: string;
  amount: number;
  currency: string;
  customerId: string;
  idempotencyKey: string;
  paymentMethod?: string;
}

export interface RefundData {
  orderId: string;
  amount: number;
  reason: string;
}

export interface WebhookPayload {
  event: string;
  data: any;
  metadata?: any;
}

// Circuit Breaker for payment gateway
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private readonly failureThreshold = 5;
  private readonly timeoutMs = 60000; // 1 minute

  isOpen(): boolean {
    if (this.failures >= this.failureThreshold) {
      const timeSinceLastFailure = Date.now() - this.lastFailureTime;
      if (timeSinceLastFailure < this.timeoutMs) {
        return true; // Circuit is open
      } else {
        // Reset circuit after timeout
        this.failures = 0;
        return false;
      }
    }
    return false;
  }

  recordSuccess() {
    this.failures = 0;
  }

  recordFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();
  }
}

export class PaymentService {
  private circuitBreaker = new CircuitBreaker();
  private retryAttempts = 3;
  private timeoutMs = 30000; // 30 seconds

  // Environment variables (should be set in .env)
  private paymentGatewayUrl = process.env.PAYMENT_GATEWAY_URL || "https://api.paymentgateway.com";
  private paymentGatewayKey = process.env.PAYMENT_GATEWAY_KEY || "";
  private webhookSecret = process.env.PAYMENT_WEBHOOK_SECRET || "";

  /**
   * Validate idempotency key to prevent duplicate payments
   */
  async validateIdempotency(idempotencyKey: string, orderId?: string) {
    const existingOrder = await db.query.orders.findFirst({
      where: eq(orders.idempotencyKey, idempotencyKey)
    });

    if (existingOrder) {
      if (orderId && existingOrder.id !== orderId) {
        throw new Error('Idempotency key already used for different order');
      }
      return existingOrder; // Return existing order for retry scenarios
    }

    return null; // Key not used, proceed
  }

  /**
   * Process payment with retry logic and idempotency
   */
  async processPayment(paymentData: PaymentData) {
    const { orderId, idempotencyKey } = paymentData;

    // Validate idempotency
    const existingOrder = await this.validateIdempotency(idempotencyKey, orderId);
    if (existingOrder) {
      return this.handleExistingOrder(existingOrder);
    }

    // Update order status to processing
    await this.updateOrderStatus(orderId, 'processing', {
      paymentGatewayId: null,
      idempotencyKey,
      paymentAttempts: 1,
      lastPaymentAttempt: new Date()
    });

    // Log initial payment attempt
    await this.logPaymentAttempt(orderId, idempotencyKey, 'initiated', {
      amount: paymentData.amount,
      currency: paymentData.currency
    });

    // Implement retry with exponential backoff
    let lastError: any = null;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        if (this.circuitBreaker.isOpen()) {
          throw new Error('Payment service temporarily unavailable');
        }

        const result = await this.callPaymentGateway(paymentData, attempt);

        // Record success
        this.circuitBreaker.recordSuccess();

        // Log successful payment
        await this.logPaymentAttempt(orderId, idempotencyKey, 'success', result);

        // Update order status
        await this.updateOrderStatus(orderId, 'completed', {
          paymentGatewayId: result.gatewayId,
          paymentAttempts: attempt
        });

        return result;

      } catch (error) {
        lastError = error;
        this.circuitBreaker.recordFailure();

        // Log failed attempt
        await this.logPaymentAttempt(orderId, idempotencyKey, 'failed', {
          attempt,
          error: error.message
        });

        // Update payment attempts
        await db.update(orders)
          .set({
            paymentAttempts: attempt,
            lastPaymentAttempt: new Date()
          })
          .where(eq(orders.id, orderId));

        if (attempt === this.retryAttempts) {
          // Mark as failed after all retries
          await this.updateOrderStatus(orderId, 'failed', {
            paymentAttempts: attempt
          });
          throw new PaymentProcessingError(`Payment failed after ${attempt} attempts`, lastError);
        }

        // Exponential backoff: 1s, 2s, 4s
        await this.delay(Math.pow(2, attempt - 1) * 1000);
      }
    }
  }

  /**
   * Handle existing order (idempotency case)
   */
  private async handleExistingOrder(order: any) {
    // Return order status based on current state
    if (order.paymentStatus === 'completed') {
      return {
        status: 'completed',
        orderId: order.id,
        gatewayId: order.paymentGatewayId
      };
    } else if (order.paymentStatus === 'processing') {
      // Still processing, return pending status
      return {
        status: 'processing',
        orderId: order.id
      };
    } else {
      throw new Error(`Payment already failed for this order. Status: ${order.paymentStatus}`);
    }
  }

  /**
   * Call payment gateway with timeout
   */
  private async callPaymentGateway(paymentData: PaymentData, attempt: number) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.paymentGatewayUrl}/v1/payments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.paymentGatewayKey}`,
          'X-Idempotency-Key': paymentData.idempotencyKey,
          'X-Attempt': attempt.toString()
        },
        body: JSON.stringify({
          amount: Math.round(paymentData.amount * 100), // Convert to cents
          currency: paymentData.currency,
          orderId: paymentData.orderId,
          customerId: paymentData.customerId,
          description: `Order ${paymentData.orderId}`,
          metadata: {
            orderId: paymentData.orderId,
            attempt
          }
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(`Payment gateway error: ${response.status} - ${errorData.message || 'Unknown error'}`);
      }

      const result = await response.json();
      return {
        gatewayId: result.id,
        status: result.status,
        amount: paymentData.amount,
        currency: paymentData.currency,
        ...result
      };

    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Payment request timeout');
      }

      throw error;
    }
  }

  /**
   * Update order payment status
   */
  private async updateOrderStatus(
    orderId: string,
    status: string,
    updates: Partial<{
      paymentGatewayId: string | null;
      idempotencyKey: string;
      paymentAttempts: number;
      lastPaymentAttempt: Date;
    }> = {}
  ) {
    await db.update(orders)
      .set({
        paymentStatus: status,
        ...updates,
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId));
  }

  /**
   * Log payment attempt for audit trail
   */
  private async logPaymentAttempt(
    orderId: string,
    idempotencyKey: string,
    status: string,
    data: any
  ) {
    await db.insert(paymentLogs).values({
      orderId,
      idempotencyKey,
      status,
      amount: data.amount || 0,
      currency: data.currency || 'USD',
      gatewayResponse: JSON.stringify(data)
    });
  }

  /**
   * Handle payment webhook with signature verification
   */
  async handlePaymentWebhook(rawBody: string, signature: string, headers: any) {
    // Verify webhook signature
    if (!this.verifyWebhookSignature(rawBody, signature)) {
      throw new WebhookVerificationError('Invalid webhook signature');
    }

    const payload: WebhookPayload = JSON.parse(rawBody);
    const orderId = payload.metadata?.orderId;

    if (!orderId) {
      throw new Error('Order ID missing in webhook payload');
    }

    // Process based on event type
    switch (payload.event) {
      case 'payment.succeeded':
        await this.handlePaymentSuccess(orderId, payload);
        break;
      case 'payment.failed':
        await this.handlePaymentFailure(orderId, payload);
        break;
      case 'payment.cancelled':
        await this.handlePaymentCancelled(orderId, payload);
        break;
      default:
        console.log(`Unhandled webhook event: ${payload.event}`);
    }

    return { status: 'ok', processed: true };
  }

  /**
   * Verify webhook signature (implementation depends on gateway)
   */
  private verifyWebhookSignature(payload: string, signature: string): boolean {
    if (!this.webhookSecret) {
      console.warn('Webhook secret not configured');
      return true; // Allow in development
    }

    try {
      // Example for Stripe-like signature
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payload, 'utf8')
        .digest('hex');

      return crypto.timingSafeEqual(
        Buffer.from(signature, 'hex'),
        Buffer.from(expectedSignature, 'hex')
      );
    } catch (error) {
      console.error('Signature verification failed:', error);
      return false;
    }
  }

  /**
   * Handle successful payment webhook
   */
  private async handlePaymentSuccess(orderId: string, payload: WebhookPayload) {
    await db.transaction(async (tx) => {
      // Update order status
      await tx.update(orders)
        .set({
          paymentStatus: 'completed',
          paymentGatewayId: payload.data.id,
          updatedAt: new Date()
        })
        .where(eq(orders.id, orderId));

      // Log webhook event
      await tx.insert(paymentLogs).values({
        orderId,
        status: 'webhook_success',
        gatewayResponse: JSON.stringify(payload),
        amount: payload.data.amount / 100,
        currency: payload.data.currency
      });
    });
  }

  /**
   * Handle failed payment webhook
   */
  private async handlePaymentFailure(orderId: string, payload: WebhookPayload) {
    await db.transaction(async (tx) => {
      // Update order status
      await tx.update(orders)
        .set({
          paymentStatus: 'failed',
          updatedAt: new Date()
        })
        .where(eq(orders.id, orderId));

      // Log webhook event
      await tx.insert(paymentLogs).values({
        orderId,
        status: 'webhook_failed',
        gatewayResponse: JSON.stringify(payload),
        amount: payload.data.amount ? payload.data.amount / 100 : 0,
        currency: payload.data.currency || 'USD'
      });
    });
  }

  /**
   * Handle cancelled payment webhook
   */
  private async handlePaymentCancelled(orderId: string, payload: WebhookPayload) {
    await db.update(orders)
      .set({
        paymentStatus: 'cancelled',
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId));
  }

  /**
   * Initiate refund
   */
  async initiateRefund(refundData: RefundData) {
    const { orderId, amount, reason } = refundData;

    // Check if order is eligible for refund
    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId)
    });

    if (!order || order.paymentStatus !== 'completed') {
      throw new Error('Order not eligible for refund');
    }

    if (amount > parseFloat(order.total)) {
      throw new Error('Refund amount exceeds order total');
    }

    // Generate refund ID
    const refundId = `refund_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    // Create refund log
    await db.insert(refundLogs).values({
      id: refundId,
      orderId,
      amount,
      reason,
      status: 'pending'
    });

    try {
      // Call payment gateway refund API
      const refundResult = await this.callRefundGateway(order.paymentGatewayId!, amount);

      // Update refund status
      await db.update(refundLogs)
        .set({
          refundId: refundResult.refundId,
          status: 'processing',
          gatewayResponse: JSON.stringify(refundResult)
        })
        .where(eq(refundLogs.id, refundId));

      return { refundId, status: 'processing' };

    } catch (error) {
      // Update refund status to failed
      await db.update(refundLogs)
        .set({
          status: 'failed',
          gatewayResponse: JSON.stringify({ error: error.message })
        })
        .where(eq(refundLogs.id, refundId));

      throw error;
    }
  }

  /**
   * Call payment gateway refund API
   */
  private async callRefundGateway(gatewayPaymentId: string, amount: number) {
    const response = await fetch(`${this.paymentGatewayUrl}/v1/refunds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.paymentGatewayKey}`
      },
      body: JSON.stringify({
        paymentId: gatewayPaymentId,
        amount: Math.round(amount * 100), // Convert to cents
        reason: 'customer_request'
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Refund failed: ${response.status} - ${errorData.message || 'Unknown error'}`);
    }

    return await response.json();
  }

  /**
   * Handle refund webhook
   */
  async handleRefundWebhook(rawBody: string, signature: string) {
    if (!this.verifyWebhookSignature(rawBody, signature)) {
      throw new WebhookVerificationError('Invalid refund webhook signature');
    }

    const payload: WebhookPayload = JSON.parse(rawBody);
    const refundId = payload.data.id;
    const status = payload.data.status;

    await db.transaction(async (tx) => {
      // Update refund status
      await tx.update(refundLogs)
        .set({
          status: status === 'succeeded' ? 'completed' : 'failed',
          gatewayResponse: JSON.stringify(payload),
          updatedAt: new Date()
        })
        .where(eq(refundLogs.refundId, refundId));

      if (status === 'succeeded') {
        // Update order status to refunded
        const refundLog = await tx.query.refundLogs.findFirst({
          where: eq(refundLogs.refundId, refundId)
        });

        if (refundLog) {
          await tx.update(orders)
            .set({
              paymentStatus: 'refunded',
              updatedAt: new Date()
            })
            .where(eq(orders.id, refundLog.orderId));
        }
      }
    });

    return { status: 'ok', processed: true };
  }

  /**
   * Utility method for delays
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Custom error classes
export class PaymentProcessingError extends Error {
  constructor(message: string, public originalError?: any) {
    super(message);
    this.name = 'PaymentProcessingError';
  }
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

// Export singleton instance
export const paymentService = new PaymentService();
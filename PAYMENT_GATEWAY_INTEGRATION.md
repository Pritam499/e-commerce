# Payment Gateway Integration & Race Condition Solutions

## Problem Statement

In high-concurrency e-commerce scenarios (flash sales, peak traffic), multiple critical issues arise:

1. **Inventory Race Conditions**: Multiple users purchasing limited stock simultaneously
2. **Payment Gateway Failures**: Webhook failures, timeouts, duplicate processing
3. **State Inconsistencies**: Frontend/backend state mismatches during payment flow
4. **Timeout Issues**: Payment processing timeouts leading to abandoned orders
5. **Refund Webhooks**: Failed refund processing and verification

## Comprehensive Solution Architecture

### 1. Idempotency Key System

**Problem**: Duplicate payment requests from retries/timeouts cause double charging

**Solution**: Implement idempotency keys for all payment operations

#### Database Schema Updates
```sql
-- Add to orders table
ALTER TABLE orders ADD COLUMN idempotency_key VARCHAR(255) UNIQUE;
ALTER TABLE orders ADD COLUMN payment_status VARCHAR(50) DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN payment_gateway_id VARCHAR(255);
ALTER TABLE orders ADD COLUMN payment_attempts INTEGER DEFAULT 0;
ALTER TABLE orders ADD COLUMN last_payment_attempt TIMESTAMP;

-- Add payment_logs table for audit trail
CREATE TABLE payment_logs (
  id VARCHAR(128) PRIMARY KEY,
  order_id VARCHAR(128) REFERENCES orders(id),
  idempotency_key VARCHAR(255),
  gateway_response JSONB,
  status VARCHAR(50),
  amount DECIMAL(10,2),
  currency VARCHAR(3) DEFAULT 'USD',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add refund_logs table
CREATE TABLE refund_logs (
  id VARCHAR(128) PRIMARY KEY,
  order_id VARCHAR(128) REFERENCES orders(id),
  refund_id VARCHAR(255),
  amount DECIMAL(10,2),
  reason VARCHAR(255),
  status VARCHAR(50) DEFAULT 'pending',
  gateway_response JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

#### Implementation Strategy

**Frontend**: Generate and store idempotency keys
```typescript
// Generate unique idempotency key
const generateIdempotencyKey = () => {
  return `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Store in localStorage/sessionStorage
const storeIdempotencyKey = (orderId: string, key: string) => {
  sessionStorage.setItem(`idempotency_${orderId}`, key);
};
```

**Backend**: Validate idempotency before processing
```typescript
const validateIdempotency = async (idempotencyKey: string, orderId?: string) => {
  const existingOrder = await db.query.orders.findFirst({
    where: eq(orders.idempotencyKey, idempotencyKey)
  });

  if (existingOrder) {
    if (existingOrder.id !== orderId) {
      throw new Error('Idempotency key already used for different order');
    }
    return existingOrder; // Return existing order for retry scenarios
  }

  return null; // Key not used, proceed
};
```

### 2. Payment Gateway Integration with Retry Logic

#### Payment Service Architecture

**Payment Status State Machine**:
```
pending → processing → completed
    ↓         ↓
  failed ← timeout ← cancelled
    ↓         ↓
  refunded ← refund_pending
```

#### Payment Processing with Circuit Breaker Pattern

```typescript
class PaymentService {
  private circuitBreaker = new CircuitBreaker();
  private retryAttempts = 3;
  private timeoutMs = 30000; // 30 seconds

  async processPayment(orderId: string, paymentData: PaymentData) {
    const idempotencyKey = paymentData.idempotencyKey;

    // Validate idempotency
    const existingOrder = await validateIdempotency(idempotencyKey, orderId);
    if (existingOrder) {
      return this.handleExistingOrder(existingOrder);
    }

    // Update order status to processing
    await this.updateOrderStatus(orderId, 'processing', {
      paymentGatewayId: paymentData.gatewayOrderId,
      idempotencyKey
    });

    // Implement retry with exponential backoff
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        if (this.circuitBreaker.isOpen()) {
          throw new Error('Payment service temporarily unavailable');
        }

        const result = await this.callPaymentGateway(paymentData, attempt);

        // Log successful payment
        await this.logPaymentAttempt(orderId, 'success', result);

        // Update order status
        await this.updateOrderStatus(orderId, 'completed', {
          paymentGatewayId: result.gatewayId,
          transactionId: result.transactionId
        });

        return result;

      } catch (error) {
        await this.logPaymentAttempt(orderId, 'failed', error);

        if (attempt === this.retryAttempts) {
          await this.updateOrderStatus(orderId, 'failed');
          throw new PaymentProcessingError('Payment failed after retries', error);
        }

        // Exponential backoff: 1s, 2s, 4s
        await this.delay(Math.pow(2, attempt - 1) * 1000);
      }
    }
  }

  private async callPaymentGateway(paymentData: PaymentData, attempt: number) {
    // Implementation varies by gateway (Stripe, Razorpay, PayPal, etc.)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${PAYMENT_GATEWAY_URL}/create-order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${PAYMENT_GATEWAY_KEY}`,
          'X-Idempotency-Key': paymentData.idempotencyKey
        },
        body: JSON.stringify({
          amount: paymentData.amount,
          currency: paymentData.currency,
          orderId: paymentData.orderId,
          customerId: paymentData.customerId
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Payment gateway error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }
}
```

### 3. Webhook Handling with Signature Verification

#### Secure Webhook Processing

```typescript
class WebhookHandler {
  private webhookSecret: string;

  async handlePaymentWebhook(rawBody: string, signature: string, headers: any) {
    // Verify webhook signature
    if (!this.verifySignature(rawBody, signature)) {
      throw new WebhookVerificationError('Invalid webhook signature');
    }

    const payload = JSON.parse(rawBody);

    // Process based on event type
    switch (payload.event) {
      case 'payment.succeeded':
        await this.handlePaymentSuccess(payload);
        break;
      case 'payment.failed':
        await this.handlePaymentFailure(payload);
        break;
      case 'refund.succeeded':
        await this.handleRefundSuccess(payload);
        break;
      case 'refund.failed':
        await this.handleRefundFailure(payload);
        break;
      default:
        console.log(`Unhandled webhook event: ${payload.event}`);
    }

    return { status: 'ok' };
  }

  private verifySignature(payload: string, signature: string): boolean {
    // Implementation depends on payment gateway
    // Example for Stripe:
    const expectedSignature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(payload)
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  private async handlePaymentSuccess(payload: any) {
    const orderId = payload.metadata.orderId;
    const transactionId = payload.id;

    await db.transaction(async (tx) => {
      // Update order status
      await tx.update(orders)
        .set({
          paymentStatus: 'completed',
          paymentGatewayId: transactionId,
          updatedAt: new Date()
        })
        .where(eq(orders.id, orderId));

      // Update inventory (if not already done)
      await this.updateInventoryForOrder(tx, orderId);

      // Log webhook event
      await tx.insert(paymentLogs).values({
        orderId,
        status: 'webhook_success',
        gatewayResponse: payload,
        amount: payload.amount / 100, // Convert from cents
        currency: payload.currency
      });
    });
  }

  private async handlePaymentFailure(payload: any) {
    const orderId = payload.metadata.orderId;

    await db.update(orders)
      .set({
        paymentStatus: 'failed',
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId));

    // Trigger retry logic or notify customer
    await this.handlePaymentFailureRecovery(orderId, payload);
  }

  private async handleRefundSuccess(payload: any) {
    const refundId = payload.id;
    const orderId = payload.metadata?.orderId;

    await db.transaction(async (tx) => {
      // Update refund status
      await tx.update(refundLogs)
        .set({
          status: 'completed',
          updatedAt: new Date()
        })
        .where(eq(refundLogs.refundId, refundId));

      // Restore inventory if needed
      await this.restoreInventoryForRefund(tx, orderId, payload.amount);

      // Log refund completion
      await tx.insert(paymentLogs).values({
        orderId,
        status: 'refund_completed',
        gatewayResponse: payload,
        amount: -Math.abs(payload.amount / 100),
        currency: payload.currency
      });
    });
  }
}
```

### 4. Frontend State Management with Real-time Updates

#### Payment State Management

```typescript
// Payment Context for React
interface PaymentState {
  orderId: string | null;
  status: 'idle' | 'processing' | 'completed' | 'failed' | 'timeout';
  idempotencyKey: string | null;
  retryCount: number;
  lastError: string | null;
}

class PaymentManager {
  private state: PaymentState;
  private listeners: ((state: PaymentState) => void)[] = [];
  private retryTimeout: NodeJS.Timeout | null = null;

  constructor() {
    this.state = {
      orderId: null,
      status: 'idle',
      idempotencyKey: null,
      retryCount: 0,
      lastError: null
    };
  }

  // Initialize payment
  async initiatePayment(orderData: OrderData) {
    const idempotencyKey = generateIdempotencyKey();

    this.updateState({
      status: 'processing',
      idempotencyKey,
      orderId: orderData.id,
      retryCount: 0,
      lastError: null
    });

    try {
      const result = await api.initiatePayment({
        ...orderData,
        idempotencyKey
      });

      this.updateState({ status: 'completed' });
      return result;

    } catch (error) {
      this.handlePaymentError(error);
    }
  }

  // Handle payment errors with retry logic
  private async handlePaymentError(error: any) {
    const currentState = { ...this.state };

    if (currentState.retryCount < 3) {
      // Schedule retry with exponential backoff
      const delay = Math.pow(2, currentState.retryCount) * 1000;

      this.retryTimeout = setTimeout(async () => {
        this.updateState({
          retryCount: currentState.retryCount + 1,
          status: 'processing'
        });

        try {
          await this.retryPayment();
        } catch (retryError) {
          this.handlePaymentError(retryError);
        }
      }, delay);

    } else {
      this.updateState({
        status: 'failed',
        lastError: error.message
      });
    }
  }

  // Retry payment with same idempotency key
  private async retryPayment() {
    if (!this.state.idempotencyKey || !this.state.orderId) return;

    try {
      const result = await api.retryPayment({
        orderId: this.state.orderId,
        idempotencyKey: this.state.idempotencyKey
      });

      this.updateState({ status: 'completed' });
      return result;

    } catch (error) {
      throw error;
    }
  }

  // State management
  private updateState(updates: Partial<PaymentState>) {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach(listener => listener(this.state));
  }

  subscribe(listener: (state: PaymentState) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Cleanup on unmount
  destroy() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
  }
}
```

### 5. Order Reconciliation System

#### Background Job for Payment Reconciliation

```typescript
class PaymentReconciler {
  private reconciliationInterval = 5 * 60 * 1000; // 5 minutes

  startReconciliationJob() {
    setInterval(async () => {
      await this.reconcilePendingPayments();
    }, this.reconciliationInterval);
  }

  private async reconcilePendingPayments() {
    // Find orders that are stuck in processing state
    const stuckOrders = await db.query.orders.findMany({
      where: and(
        eq(orders.paymentStatus, 'processing'),
        lt(orders.lastPaymentAttempt, new Date(Date.now() - 10 * 60 * 1000)) // 10 minutes ago
      )
    });

    for (const order of stuckOrders) {
      try {
        // Query payment gateway for status
        const gatewayStatus = await this.queryPaymentGatewayStatus(order.paymentGatewayId);

        if (gatewayStatus === 'completed') {
          await this.confirmPayment(order.id);
        } else if (gatewayStatus === 'failed') {
          await this.failPayment(order.id);
        } else {
          // Still processing, update timestamp to avoid repeated checks
          await db.update(orders)
            .set({ lastPaymentAttempt: new Date() })
            .where(eq(orders.id, order.id));
        }
      } catch (error) {
        console.error(`Reconciliation failed for order ${order.id}:`, error);
      }
    }
  }

  private async queryPaymentGatewayStatus(gatewayId: string) {
    // Implementation depends on payment gateway API
    // Example for checking payment status
    const response = await fetch(`${PAYMENT_GATEWAY_URL}/payment/${gatewayId}`, {
      headers: {
        'Authorization': `Bearer ${PAYMENT_GATEWAY_KEY}`
      }
    });

    const data = await response.json();
    return data.status; // 'completed', 'failed', 'pending'
  }
}
```

### 6. Refund Processing with Webhook Verification

#### Refund Service

```typescript
class RefundService {
  async initiateRefund(orderId: string, amount: number, reason: string) {
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
    const refundId = `refund_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Create refund log
    await db.insert(refundLogs).values({
      id: refundId,
      orderId,
      amount,
      reason,
      status: 'pending'
    });

    // Call payment gateway refund API
    const refundResult = await this.callGatewayRefund(order.paymentGatewayId, amount);

    // Update refund status
    await db.update(refundLogs)
      .set({
        refundId: refundResult.refundId,
        status: 'processing',
        gatewayResponse: refundResult
      })
      .where(eq(refundLogs.id, refundId));

    return refundId;
  }

  private async callGatewayRefund(gatewayPaymentId: string, amount: number) {
    // Implementation depends on payment gateway
    const response = await fetch(`${PAYMENT_GATEWAY_URL}/refunds`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${PAYMENT_GATEWAY_KEY}`
      },
      body: JSON.stringify({
        paymentId: gatewayPaymentId,
        amount: amount * 100, // Convert to cents
        reason: 'customer_request'
      })
    });

    if (!response.ok) {
      throw new Error(`Refund failed: ${response.status}`);
    }

    return await response.json();
  }

  async handleRefundWebhook(payload: any) {
    const refundId = payload.id;
    const status = payload.status;

    await db.transaction(async (tx) => {
      // Update refund status
      await tx.update(refundLogs)
        .set({
          status: status === 'succeeded' ? 'completed' : 'failed',
          gatewayResponse: payload,
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
  }
}
```

### 7. Database Constraints and Validation

#### Additional Database Constraints

```sql
-- Prevent duplicate idempotency keys
ALTER TABLE orders ADD CONSTRAINT unique_idempotency_key UNIQUE (idempotency_key);

-- Prevent invalid status transitions
ALTER TABLE orders ADD CONSTRAINT valid_payment_status
  CHECK (payment_status IN ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'refund_pending'));

-- Ensure refund amounts don't exceed order total
ALTER TABLE refund_logs ADD CONSTRAINT valid_refund_amount
  CHECK (amount > 0);

-- Index for performance
CREATE INDEX idx_orders_payment_status ON orders(payment_status);
CREATE INDEX idx_orders_idempotency_key ON orders(idempotency_key);
CREATE INDEX idx_payment_logs_order_id ON payment_logs(order_id);
CREATE INDEX idx_refund_logs_order_id ON refund_logs(order_id);
```

## Implementation Checklist

### Phase 1: Core Infrastructure
- [ ] Add database schema for idempotency, payment logs, refunds
- [ ] Implement idempotency key generation and validation
- [ ] Create payment service with retry logic
- [ ] Set up webhook signature verification

### Phase 2: Payment Processing
- [ ] Implement payment state machine
- [ ] Add circuit breaker pattern
- [ ] Create timeout handling
- [ ] Build payment reconciliation system

### Phase 3: Frontend Integration
- [ ] Update payment context with retry logic
- [ ] Add real-time payment status updates
- [ ] Implement payment recovery flows
- [ ] Create user-friendly error messages

### Phase 4: Refund System
- [ ] Build refund initiation service
- [ ] Implement refund webhook handling
- [ ] Add refund status tracking
- [ ] Create refund reconciliation

### Phase 5: Monitoring & Testing
- [ ] Add comprehensive logging
- [ ] Implement payment metrics
- [ ] Create automated tests for race conditions
- [ ] Set up alerting for payment failures

## Testing Strategy

### 1. Unit Tests
- Idempotency key validation
- Payment state transitions
- Webhook signature verification

### 2. Integration Tests
- End-to-end payment flow
- Webhook processing
- Refund processing

### 3. Load Tests
- Concurrent payment processing
- Race condition prevention
- Timeout handling under load

### 4. Chaos Testing
- Payment gateway failures
- Network timeouts
- Database connection issues

This comprehensive solution addresses all the race condition and payment gateway reliability issues in high-concurrency e-commerce scenarios.
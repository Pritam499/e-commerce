// Payment utilities for frontend

export interface PaymentState {
  orderId: string | null;
  status: 'idle' | 'processing' | 'completed' | 'failed' | 'timeout';
  idempotencyKey: string | null;
  retryCount: number;
  lastError: string | null;
  gatewayOrderId?: string;
}

/**
 * Generate unique idempotency key for payments
 */
export function generateIdempotencyKey(): string {
  return `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Store idempotency key in sessionStorage
 */
export function storeIdempotencyKey(orderId: string, key: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem(`idempotency_${orderId}`, key);
  }
}

/**
 * Retrieve idempotency key from sessionStorage
 */
export function getIdempotencyKey(orderId: string): string | null {
  if (typeof window !== 'undefined') {
    return sessionStorage.getItem(`idempotency_${orderId}`);
  }
  return null;
}

/**
 * Clear idempotency key from sessionStorage
 */
export function clearIdempotencyKey(orderId: string): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(`idempotency_${orderId}`);
  }
}

/**
 * Payment state manager class
 */
export class PaymentManager {
  private state: PaymentState;
  private listeners: ((state: PaymentState) => void)[] = [];
  private retryTimeout: NodeJS.Timeout | null = null;
  private maxRetries = 3;

  constructor() {
    this.state = {
      orderId: null,
      status: 'idle',
      idempotencyKey: null,
      retryCount: 0,
      lastError: null
    };
  }

  // Get current state
  getState(): PaymentState {
    return { ...this.state };
  }

  // Subscribe to state changes
  subscribe(listener: (state: PaymentState) => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Update state and notify listeners
  private updateState(updates: Partial<PaymentState>) {
    this.state = { ...this.state, ...updates };
    this.listeners.forEach(listener => listener(this.state));
  }

  // Initialize payment
  async initiatePayment(orderData: {
    orderId: string;
    amount: number;
    customerId: string;
    currency?: string;
  }) {
    const idempotencyKey = generateIdempotencyKey();

    this.updateState({
      status: 'processing',
      orderId: orderData.orderId,
      idempotencyKey,
      retryCount: 0,
      lastError: null
    });

    // Store idempotency key
    storeIdempotencyKey(orderData.orderId, idempotencyKey);

    try {
      const result = await this.callPaymentAPI({
        ...orderData,
        idempotencyKey,
        currency: orderData.currency || 'USD'
      });

      this.updateState({ status: 'completed', gatewayOrderId: result.gatewayId });
      return result;

    } catch (error) {
      this.handlePaymentError(error);
      throw error;
    }
  }

  // Retry payment
  async retryPayment() {
    if (!this.state.orderId || !this.state.idempotencyKey) {
      throw new Error('No payment to retry');
    }

    if (this.state.retryCount >= this.maxRetries) {
      throw new Error('Maximum retry attempts exceeded');
    }

    this.updateState({
      status: 'processing',
      retryCount: this.state.retryCount + 1
    });

    try {
      const result = await this.callRetryAPI(this.state.orderId, this.state.idempotencyKey);
      this.updateState({ status: 'completed' });
      return result;
    } catch (error) {
      this.handlePaymentError(error);
      throw error;
    }
  }

  // Handle payment errors with automatic retry
  private handlePaymentError(error: any) {
    const currentState = { ...this.state };
    const errorMessage = error.message || 'Payment failed';

    if (currentState.retryCount < this.maxRetries) {
      // Schedule automatic retry with exponential backoff
      const delay = Math.pow(2, currentState.retryCount) * 1000; // 1s, 2s, 4s

      this.retryTimeout = setTimeout(async () => {
        try {
          await this.retryPayment();
        } catch (retryError) {
          // Final failure after retry
          this.updateState({
            status: 'failed',
            lastError: retryError.message
          });
        }
      }, delay);

      this.updateState({
        status: 'processing',
        lastError: `Retrying... (${currentState.retryCount + 1}/${this.maxRetries})`
      });

    } else {
      this.updateState({
        status: 'failed',
        lastError: errorMessage
      });
    }
  }

  // Call payment API
  private async callPaymentAPI(paymentData: {
    orderId: string;
    amount: number;
    customerId: string;
    currency: string;
    idempotencyKey: string;
  }) {
    const response = await fetch('/api/payments/initiate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(paymentData)
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Payment failed');
    }

    return await response.json();
  }

  // Call retry API
  private async callRetryAPI(orderId: string, idempotencyKey: string) {
    const response = await fetch(`/api/payments/retry/${orderId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ idempotencyKey })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Retry failed');
    }

    return await response.json();
  }

  // Get payment status
  async getPaymentStatus(orderId?: string) {
    const targetOrderId = orderId || this.state.orderId;
    if (!targetOrderId) {
      throw new Error('No order ID available');
    }

    const response = await fetch(`/api/payments/status/${targetOrderId}`);

    if (!response.ok) {
      throw new Error('Failed to get payment status');
    }

    const result = await response.json();
    return result.data;
  }

  // Reset payment state
  reset() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
      this.retryTimeout = null;
    }

    if (this.state.orderId) {
      clearIdempotencyKey(this.state.orderId);
    }

    this.updateState({
      orderId: null,
      status: 'idle',
      idempotencyKey: null,
      retryCount: 0,
      lastError: null,
      gatewayOrderId: undefined
    });
  }

  // Cleanup
  destroy() {
    if (this.retryTimeout) {
      clearTimeout(this.retryTimeout);
    }
    this.listeners = [];
  }
}

// Export singleton instance
export const paymentManager = new PaymentManager();

// Utility functions for payment UI
export function formatPaymentError(error: any): string {
  if (typeof error === 'string') return error;

  if (error.message) return error.message;

  if (error.error) return error.error;

  return 'An unknown payment error occurred';
}

export function isRetryableError(error: any): boolean {
  const retryableCodes = ['timeout', 'network', 'server_error'];
  const errorMessage = error.message?.toLowerCase() || '';
  const errorCode = error.code?.toLowerCase() || '';

  return retryableCodes.some(code =>
    errorMessage.includes(code) || errorCode.includes(code)
  );
}
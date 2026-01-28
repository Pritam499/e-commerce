import { eq, and, lt } from "drizzle-orm";
import { db } from "../../lib/db";
import { orders } from "../../drizzle/schema";

export class PaymentReconciler {
  private reconciliationInterval = 5 * 60 * 1000; // 5 minutes
  private maxProcessingTime = 10 * 60 * 1000; // 10 minutes
  private intervalId: NodeJS.Timeout | null = null;

  startReconciliationJob() {
    console.log('🚀 Starting payment reconciliation job...');
    this.intervalId = setInterval(async () => {
      try {
        await this.reconcilePendingPayments();
      } catch (error) {
        console.error('❌ Reconciliation job failed:', error);
      }
    }, this.reconciliationInterval);
  }

  stopReconciliationJob() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      console.log('🛑 Payment reconciliation job stopped');
    }
  }

  private async reconcilePendingPayments() {
    console.log('🔍 Checking for stuck payments...');

    // Find orders that are stuck in processing state for too long
    const stuckOrders = await db.query.orders.findMany({
      where: and(
        eq(orders.paymentStatus, 'processing'),
        lt(orders.lastPaymentAttempt, new Date(Date.now() - this.maxProcessingTime))
      ),
      columns: {
        id: true,
        customerId: true,
        paymentGatewayId: true,
        total: true,
        paymentAttempts: true,
        lastPaymentAttempt: true
      }
    });

    console.log(`📋 Found ${stuckOrders.length} stuck payments to reconcile`);

    for (const order of stuckOrders) {
      try {
        console.log(`🔄 Reconciling order ${order.id}...`);

        // Query payment gateway for current status
        const gatewayStatus = await this.queryPaymentGatewayStatus(order);

        if (gatewayStatus === 'completed' || gatewayStatus === 'paid') {
          await this.confirmPayment(order.id);
          console.log(`✅ Order ${order.id} confirmed as completed`);
        } else if (gatewayStatus === 'failed' || gatewayStatus === 'cancelled') {
          await this.failPayment(order.id);
          console.log(`❌ Order ${order.id} marked as failed`);
        } else if (gatewayStatus === 'pending') {
          // Still pending, update timestamp to avoid repeated checks
          await this.updateLastAttempt(order.id);
          console.log(`⏳ Order ${order.id} still pending`);
        } else {
          console.log(`❓ Order ${order.id} has unknown status: ${gatewayStatus}`);
          // Update timestamp anyway to avoid infinite retries
          await this.updateLastAttempt(order.id);
        }
      } catch (error) {
        console.error(`💥 Failed to reconcile order ${order.id}:`, error);
        // Update timestamp to avoid immediate retry
        await this.updateLastAttempt(order.id);
      }
    }
  }

  private async queryPaymentGatewayStatus(order: any): Promise<string> {
    // This would integrate with actual payment gateway API
    // For now, we'll simulate based on order data

    if (!order.paymentGatewayId) {
      // No gateway ID means payment was never initiated properly
      return 'failed';
    }

    // Simulate gateway API call
    try {
      // In real implementation, this would call:
      // const response = await fetch(`${PAYMENT_GATEWAY_URL}/payment/${order.paymentGatewayId}`);
      // const data = await response.json();
      // return data.status;

      // For demo purposes, randomly resolve some payments
      const random = Math.random();

      if (random < 0.3) {
        return 'completed'; // 30% success rate
      } else if (random < 0.5) {
        return 'failed'; // 20% failure rate
      } else {
        return 'pending'; // 50% still pending
      }
    } catch (error) {
      console.error(`Gateway query failed for order ${order.id}:`, error);
      return 'unknown';
    }
  }

  private async confirmPayment(orderId: string) {
    await db.transaction(async (tx) => {
      // Update order status
      await tx.update(orders)
        .set({
          paymentStatus: 'completed',
          updatedAt: new Date()
        })
        .where(eq(orders.id, orderId));

      // Here you could also update inventory if not already done
      // This depends on your business logic
    });
  }

  private async failPayment(orderId: string) {
    await db.update(orders)
      .set({
        paymentStatus: 'failed',
        updatedAt: new Date()
      })
      .where(eq(orders.id, orderId));
  }

  private async updateLastAttempt(orderId: string) {
    await db.update(orders)
      .set({
        lastPaymentAttempt: new Date()
      })
      .where(eq(orders.id, orderId));
  }

  // Manual reconciliation trigger for specific order
  async reconcileOrder(orderId: string) {
    console.log(`🔄 Manual reconciliation for order ${orderId}`);

    const order = await db.query.orders.findFirst({
      where: eq(orders.id, orderId),
      columns: {
        id: true,
        paymentStatus: true,
        paymentGatewayId: true,
        lastPaymentAttempt: true
      }
    });

    if (!order) {
      throw new Error(`Order ${orderId} not found`);
    }

    if (order.paymentStatus !== 'processing') {
      throw new Error(`Order ${orderId} is not in processing state`);
    }

    const gatewayStatus = await this.queryPaymentGatewayStatus(order);

    if (gatewayStatus === 'completed' || gatewayStatus === 'paid') {
      await this.confirmPayment(orderId);
      return { status: 'completed', orderId };
    } else if (gatewayStatus === 'failed' || gatewayStatus === 'cancelled') {
      await this.failPayment(orderId);
      return { status: 'failed', orderId };
    } else {
      await this.updateLastAttempt(orderId);
      return { status: 'still_processing', orderId };
    }
  }

  // Get reconciliation statistics
  async getReconciliationStats() {
    const stats = await db.$count(orders, eq(orders.paymentStatus, 'processing'));
    const stuckOrders = await db.$count(
      orders,
      and(
        eq(orders.paymentStatus, 'processing'),
        lt(orders.lastPaymentAttempt, new Date(Date.now() - this.maxProcessingTime))
      )
    );

    return {
      processingOrders: stats,
      stuckOrders,
      reconciliationInterval: this.reconciliationInterval,
      maxProcessingTime: this.maxProcessingTime
    };
  }
}

// Export singleton instance
export const paymentReconciler = new PaymentReconciler();
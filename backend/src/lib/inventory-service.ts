import { eq, and, sql, gte, lte } from "drizzle-orm";
import { db } from "./db";
import { products, orders, orderItems, cartItems } from "../drizzle/schema";
import { logger } from "./logger";
import { wsService } from "./websocket-service";

export interface InventoryReservation {
  id: string;
  productId: string;
  orderId: string;
  userId: string;
  quantity: number;
  expiresAt: Date;
  createdAt: Date;
}

export interface InventoryTransaction {
  id: string;
  productId: string;
  type: 'reservation' | 'commitment' | 'cancellation' | 'return' | 'adjustment' | 'restock';
  quantity: number;
  previousStock: number;
  newStock: number;
  orderId?: string;
  userId?: string;
  reason?: string;
  createdAt: Date;
}

// In-memory inventory reservations (use Redis in production)
class InventoryReservationStore {
  private reservations = new Map<string, InventoryReservation>();

  add(reservation: InventoryReservation): void {
    this.reservations.set(reservation.id, reservation);
  }

  get(id: string): InventoryReservation | undefined {
    return this.reservations.get(id);
  }

  getByOrder(orderId: string): InventoryReservation[] {
    return Array.from(this.reservations.values())
      .filter(r => r.orderId === orderId);
  }

  getByProduct(productId: string): InventoryReservation[] {
    return Array.from(this.reservations.values())
      .filter(r => r.productId === productId);
  }

  remove(id: string): void {
    this.reservations.delete(id);
  }

  cleanup(): void {
    const now = new Date();
    let cleaned = 0;

    for (const [id, reservation] of this.reservations.entries()) {
      if (reservation.expiresAt < now) {
        this.reservations.delete(id);
        cleaned++;

        logger.info('Expired inventory reservation cleaned up', {
          reservationId: id,
          productId: reservation.productId,
          orderId: reservation.orderId,
        });
      }
    }

    if (cleaned > 0) {
      logger.info('Cleaned up expired reservations', { count: cleaned });
    }
  }

  getStats(): { total: number; expiringSoon: number } {
    const now = new Date();
    const soon = new Date(now.getTime() + 5 * 60 * 1000); // 5 minutes

    const expiringSoon = Array.from(this.reservations.values())
      .filter(r => r.expiresAt > now && r.expiresAt <= soon).length;

    return {
      total: this.reservations.size,
      expiringSoon,
    };
  }
}

export class InventoryService {
  private reservationStore = new InventoryReservationStore();
  private transactionLog: InventoryTransaction[] = [];

  constructor() {
    // Cleanup expired reservations every 5 minutes
    setInterval(() => this.reservationStore.cleanup(), 5 * 60 * 1000);

    // Log stats every 10 minutes
    setInterval(() => this.logStats(), 10 * 60 * 1000);
  }

  // Check if product has sufficient stock (including reservations)
  async checkAvailability(productId: string, quantity: number): Promise<{
    available: boolean;
    currentStock: number;
    reservedStock: number;
    availableStock: number;
  }> {
    const [product] = await db.select().from(products).where(eq(products.id, productId));

    if (!product) {
      throw new Error('Product not found');
    }

    const reservations = this.reservationStore.getByProduct(productId);
    const reservedStock = reservations.reduce((sum, r) => sum + r.quantity, 0);
    const availableStock = product.stock - reservedStock;

    return {
      available: availableStock >= quantity,
      currentStock: product.stock,
      reservedStock,
      availableStock,
    };
  }

  // Reserve inventory for an order (temporary hold)
  async reserveInventory(orderId: string, userId: string, items: Array<{
    productId: string;
    quantity: number;
  }>): Promise<{ success: boolean; failedItems: Array<{ productId: string; requested: number; available: number }> }> {
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    const failedItems: Array<{ productId: string; requested: number; available: number }> = [];

    logger.info('Starting inventory reservation', { orderId, userId, itemCount: items.length });

    // Check availability for all items first
    for (const item of items) {
      const availability = await this.checkAvailability(item.productId, item.quantity);
      if (!availability.available) {
        failedItems.push({
          productId: item.productId,
          requested: item.quantity,
          available: availability.availableStock,
        });
      }
    }

    if (failedItems.length > 0) {
      logger.warn('Inventory reservation failed - insufficient stock', {
        orderId,
        failedItems,
      });
      return { success: false, failedItems };
    }

    // Create reservations
    for (const item of items) {
      const reservation: InventoryReservation = {
        id: `${reservationId}_${item.productId}`,
        productId: item.productId,
        orderId,
        userId,
        quantity: item.quantity,
        expiresAt,
        createdAt: new Date(),
      };

      this.reservationStore.add(reservation);

      logger.info('Inventory reserved', {
        reservationId: reservation.id,
        productId: item.productId,
        quantity: item.quantity,
        expiresAt: reservation.expiresAt,
      });
    }

    return { success: true, failedItems: [] };
  }

  // Commit reservation (convert to actual inventory reduction)
  async commitReservation(orderId: string): Promise<void> {
    const reservations = this.reservationStore.getByOrder(orderId);

    if (reservations.length === 0) {
      logger.warn('No reservations found for order', { orderId });
      return;
    }

    logger.info('Committing inventory reservations', { orderId, reservationCount: reservations.length });

    for (const reservation of reservations) {
      await this.updateStock(
        reservation.productId,
        -reservation.quantity,
        'commitment',
        orderId,
        reservation.userId,
        `Order ${orderId} committed`
      );

      this.reservationStore.remove(reservation.id);
    }
  }

  // Cancel reservation (release held inventory)
  async cancelReservation(orderId: string): Promise<void> {
    const reservations = this.reservationStore.getByOrder(orderId);

    if (reservations.length === 0) {
      logger.warn('No reservations found for order', { orderId });
      return;
    }

    logger.info('Cancelling inventory reservations', { orderId, reservationCount: reservations.length });

    // Just remove reservations - stock remains unchanged
    for (const reservation of reservations) {
      this.reservationStore.remove(reservation.id);

      logger.info('Inventory reservation cancelled', {
        reservationId: reservation.id,
        productId: reservation.productId,
        quantity: reservation.quantity,
      });
    }
  }

  // Return items (increase inventory)
  async returnItems(orderId: string, returns: Array<{
    productId: string;
    quantity: number;
    reason: string;
  }>): Promise<void> {
    logger.info('Processing item returns', { orderId, returnCount: returns.length });

    for (const returnItem of returns) {
      await this.updateStock(
        returnItem.productId,
        returnItem.quantity,
        'return',
        orderId,
        undefined, // userId not needed for returns
        `Return: ${returnItem.reason}`
      );
    }
  }

  // Update stock directly (for manual adjustments, restocking, etc.)
  async updateStock(
    productId: string,
    quantityChange: number,
    type: InventoryTransaction['type'],
    orderId?: string,
    userId?: string,
    reason?: string
  ): Promise<void> {
    // Get current stock
    const [product] = await db.select().from(products).where(eq(products.id, productId));

    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    const previousStock = product.stock;
    const newStock = Math.max(0, previousStock + quantityChange);

    // Update database
    await db.update(products)
      .set({
        stock: newStock,
        updatedAt: new Date(),
      })
      .where(eq(products.id, productId));

    // Log transaction
    const transaction: InventoryTransaction = {
      id: `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      productId,
      type,
      quantity: quantityChange,
      previousStock,
      newStock,
      orderId,
      userId,
      reason,
      createdAt: new Date(),
    };

    this.transactionLog.push(transaction);

    // Keep only last 1000 transactions in memory
    if (this.transactionLog.length > 1000) {
      this.transactionLog.shift();
    }

    // Broadcast real-time update
    wsService.broadcastInventoryUpdate({
      productId,
      previousStock,
      newStock,
      reason: type as any,
      orderId,
      userId,
    });

    logger.info('Stock updated', {
      productId,
      type,
      quantityChange,
      previousStock,
      newStock,
      orderId,
      userId,
    });
  }

  // Bulk operations for efficiency
  async bulkUpdateStock(updates: Array<{
    productId: string;
    quantityChange: number;
    type: InventoryTransaction['type'];
    orderId?: string;
    userId?: string;
    reason?: string;
  }>): Promise<void> {
    logger.info('Starting bulk stock update', { updateCount: updates.length });

    for (const update of updates) {
      await this.updateStock(
        update.productId,
        update.quantityChange,
        update.type,
        update.orderId,
        update.userId,
        update.reason
      );
    }
  }

  // Get inventory status for a product
  async getInventoryStatus(productId: string): Promise<{
    productId: string;
    currentStock: number;
    reservedStock: number;
    availableStock: number;
    reservations: Array<{
      orderId: string;
      quantity: number;
      expiresAt: Date;
    }>;
  }> {
    const [product] = await db.select().from(products).where(eq(products.id, productId));

    if (!product) {
      throw new Error(`Product ${productId} not found`);
    }

    const reservations = this.reservationStore.getByProduct(productId);
    const reservedStock = reservations.reduce((sum, r) => sum + r.quantity, 0);

    return {
      productId,
      currentStock: product.stock,
      reservedStock,
      availableStock: product.stock - reservedStock,
      reservations: reservations.map(r => ({
        orderId: r.orderId,
        quantity: r.quantity,
        expiresAt: r.expiresAt,
      })),
    };
  }

  // Get low stock alerts
  async getLowStockAlerts(threshold: number = 5): Promise<Array<{
    productId: string;
    name: string;
    currentStock: number;
    availableStock: number;
  }>> {
    // Get all products with low stock
    const lowStockProducts = await db.query.products.findMany({
      where: lte(products.stock, threshold),
      with: {
        category: true,
      },
    });

    const alerts = [];

    for (const product of lowStockProducts) {
      const reservations = this.reservationStore.getByProduct(product.id);
      const reservedStock = reservations.reduce((sum, r) => sum + r.quantity, 0);
      const availableStock = product.stock - reservedStock;

      alerts.push({
        productId: product.id,
        name: product.name,
        currentStock: product.stock,
        availableStock,
      });
    }

    return alerts;
  }

  // Get transaction history for a product
  getTransactionHistory(productId: string, limit: number = 50): InventoryTransaction[] {
    return this.transactionLog
      .filter(t => t.productId === productId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  // Analytics
  getAnalytics(): {
    totalReservations: number;
    expiringSoonReservations: number;
    recentTransactions: InventoryTransaction[];
    lowStockAlerts: number;
  } {
    const reservationStats = this.reservationStore.getStats();

    return {
      totalReservations: reservationStats.total,
      expiringSoonReservations: reservationStats.expiringSoon,
      recentTransactions: this.transactionLog.slice(-10),
      lowStockAlerts: 0, // Will be populated when called
    };
  }

  private logStats(): void {
    const analytics = this.getAnalytics();

    logger.info('Inventory service stats', {
      reservations: analytics.totalReservations,
      expiringSoon: analytics.expiringSoonReservations,
      recentTransactions: analytics.recentTransactions.length,
    });
  }
}

// Global inventory service instance
export const inventoryService = new InventoryService();
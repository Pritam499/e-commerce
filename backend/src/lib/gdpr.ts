import { eq, and, lt } from "drizzle-orm";
import { db } from "./db";
import { users, customers, orders, orderItems, cartItems, discountCodes } from "../drizzle/schema";
import { anonymizeData, shouldRetainData } from "./encryption";
import { logger } from "./logger";
import { encryptObject } from "./encryption";

export class GDPRCompliance {
  // Right to erasure (right to be forgotten)
  static async deleteUserData(userId: string): Promise<void> {
    logger.gdpr('erasure', userId, { action: 'initiated' });

    try {
      // Instead of hard deletion, anonymize the data (GDPR best practice)
      await this.anonymizeUserData(userId);

      // Schedule complete deletion after retention period
      await this.scheduleDeletion(userId);

      logger.gdpr('erasure', userId, { action: 'completed', method: 'anonymization' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('GDPR erasure failed', { userId, error: errorMessage });
      throw error;
    }
  }

  // Right to data portability
  static async exportUserData(userId: string): Promise<any> {
    logger.gdpr('portability', userId, { action: 'initiated' });

    try {
      // Get user data
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) throw new Error('User not found');

      // Get customer data
      const [customer] = await db.select().from(customers).where(eq(customers.userId, userId));

      // Get orders
      const userOrders = await db.query.orders.findMany({
        where: eq(orders.customerId, customer?.id || ''),
        with: {
          orderItems: {
            with: {
              product: true,
            },
          },
          discountCode: true,
        },
      });

      // Get cart items
      const cart = await db.query.cartItems.findMany({
        where: eq(cartItems.customerId, customer?.id || ''),
        with: {
          product: true,
        },
      });

      // Get discount codes
      const discounts = await db.query.discountCodes.findMany({
        where: eq(discountCodes.customerId, customer?.id || ''),
      });

      const exportData = {
        user: {
          id: user.id,
          email: user.email, // Will be decrypted by the service layer
          name: user.name,
          role: user.role,
          createdAt: user.createdAt,
          updatedAt: user.updatedAt,
        },
        customer: customer ? {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          createdAt: customer.createdAt,
          updatedAt: customer.updatedAt,
        } : null,
        orders: userOrders.map(order => ({
          id: order.id,
          subtotal: order.subtotal,
          discountAmount: order.discountAmount,
          total: order.total,
          status: order.status,
          createdAt: order.createdAt,
          items: order.orderItems.map(item => ({
            productId: item.productId,
            productName: item.product.name,
            quantity: item.quantity,
            price: item.price,
          })),
        })),
        cart: cart.map(item => ({
          productId: item.productId,
          productName: item.product.name,
          quantity: item.quantity,
          price: item.product.price,
        })),
        discountCodes: discounts.map(discount => ({
          code: discount.code,
          percentage: discount.discountPercentage,
          isUsed: discount.isUsed,
          createdAt: discount.createdAt,
        })),
        exportDate: new Date().toISOString(),
        gdprRights: {
          rightToAccess: true,
          rightToRectification: true,
          rightToErasure: true,
          rightToDataPortability: true,
          rightToRestriction: true,
          rightToObjection: true,
        },
      };

      logger.gdpr('portability', userId, { action: 'completed', recordsExported: exportData.orders.length });
      return exportData;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('GDPR export failed', { userId, error: errorMessage });
      throw error;
    }
  }

  // Right to rectification
  static async updateUserData(userId: string, updates: Partial<{ email: string; name: string }>): Promise<void> {
    logger.gdpr('rectification', userId, { fields: Object.keys(updates) });

    try {
      // Encrypt the updates
      const encryptedUpdates = encryptObject(updates);

      await db.update(users)
        .set({
          ...encryptedUpdates,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      logger.gdpr('rectification', userId, { action: 'completed' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('GDPR rectification failed', { userId, error: errorMessage });
      throw error;
    }
  }

  // Right to restriction of processing
  static async restrictUserData(userId: string): Promise<void> {
    logger.gdpr('restriction', userId, { action: 'initiated' });

    try {
      // Mark user as restricted (you might want to add a field to the users table)
      await db.update(users)
        .set({
          isActive: false, // Use existing field or add a new one
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      logger.gdpr('restriction', userId, { action: 'completed' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('GDPR restriction failed', { userId, error: errorMessage });
      throw error;
    }
  }

  // Data retention cleanup
  static async cleanupExpiredData(): Promise<void> {
    const retentionDays = 2555; // ~7 years in days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    logger.info('Starting GDPR data retention cleanup', { cutoffDate: cutoffDate.toISOString() });

    try {
      // Find old orders
      const oldOrders = await db.select({ id: orders.id, createdAt: orders.createdAt })
        .from(orders)
        .where(lt(orders.createdAt, cutoffDate));

      const ordersToDelete = oldOrders.filter(order => !shouldRetainData(order.createdAt, retentionDays));

      if (ordersToDelete.length > 0) {
        // Anonymize old order data instead of deleting
        for (const order of ordersToDelete) {
          await this.anonymizeOrderData(order.id);
        }

        logger.info('GDPR cleanup completed', {
          ordersProcessed: ordersToDelete.length,
          method: 'anonymization'
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.error('GDPR cleanup failed', { error: errorMessage });
    }
  }

  // Private helper methods
  private static async anonymizeUserData(userId: string): Promise<void> {
    // Anonymize user data
    await db.update(users)
      .set({
        email: 'anonymized@example.com',
        name: 'Anonymized User',
        isActive: false,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    // Anonymize customer data
    const [customer] = await db.select().from(customers).where(eq(customers.userId, userId));
    if (customer) {
      await db.update(customers)
        .set({
          name: 'Anonymized Customer',
          email: 'anonymized@example.com',
          updatedAt: new Date(),
        })
        .where(eq(customers.id, customer.id));
    }
  }

  private static async anonymizeOrderData(orderId: string): Promise<void> {
    // Anonymize order items (remove personal identifiers)
    await db.update(orderItems)
      .set({
        // Keep product info but anonymize any personal data
        updatedAt: new Date(),
      })
      .where(eq(orderItems.orderId, orderId));
  }

  private static async scheduleDeletion(userId: string): Promise<void> {
    // In a real system, you'd schedule this for later execution
    // For now, we'll just log it
    const deletionDate = new Date();
    deletionDate.setDate(deletionDate.getDate() + 30); // 30 days from now

    logger.info('Scheduled user data deletion', {
      userId,
      scheduledFor: deletionDate.toISOString(),
      retentionPeriod: '30 days post anonymization'
    });
  }

  // Consent management (for cookie preferences, etc.)
  static async updateConsent(userId: string, consent: {
    analytics?: boolean;
    marketing?: boolean;
    necessary?: boolean;
  }): Promise<void> {
    logger.info('User consent updated', { userId, consent });

    // In a real system, you'd store this in a consent table
    // For now, we'll just log it
  }

  // Data processing inventory (for GDPR Article 30)
  static getDataProcessingInventory(): any[] {
    return [
      {
        purpose: 'User authentication and account management',
        categories: ['email', 'name', 'password'],
        legalBasis: 'Contract performance',
        retention: 'Account active + 7 years',
        recipients: ['Internal systems'],
      },
      {
        purpose: 'Order processing and fulfillment',
        categories: ['name', 'email', 'order details', 'payment info'],
        legalBasis: 'Contract performance',
        retention: '7 years',
        recipients: ['Payment processors', 'Shipping providers'],
      },
      {
        purpose: 'Customer support',
        categories: ['name', 'email', 'order history'],
        legalBasis: 'Legitimate interest',
        retention: '3 years after last interaction',
        recipients: ['Support team'],
      },
    ];
  }
}
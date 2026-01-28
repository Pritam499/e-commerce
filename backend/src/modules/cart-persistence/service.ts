import { eq, and, gt, lt, sql } from "drizzle-orm";
import { db } from "../../lib/db";
import { cartItems, customers } from "../../drizzle/schema";
import { getCartItems } from "../cart/service";
import { emitEvent, createEvent } from "../events/emitter";
import { EVENT_TYPES } from "../events/types";
import { redisCache } from "../cache/redis-service";
import crypto from "crypto";

export interface CartSessionData {
  items: any[];
  lastActivity: Date;
  itemCount: number;
  totalValue: number;
}

export interface AbandonedCart {
  customerId: string;
  customerEmail?: string;
  cartItems: any[];
  lastActivity: Date;
  totalValue: number;
}

export interface CartRecoveryData {
  id: string;
  customerId: string;
  recoveryToken: string;
  cartSnapshot: CartSessionData;
  emailSent: boolean;
  emailSentAt?: Date;
  recovered: boolean;
  recoveredAt?: Date;
  expiresAt: Date;
  createdAt: Date;
}

export class CartSessionManager {
  private sessionTimeout = 30 * 24 * 60 * 60; // 30 days in seconds for Redis
  private activityTimeout = 24 * 60 * 60 * 1000; // 24 hours for abandonment detection

  /**
   * Update cart session in Redis with current cart data
   */
  async updateSession(customerId: string, cartItems: any[]): Promise<void> {
    const sessionData: CartSessionData = {
      items: cartItems,
      lastActivity: new Date(),
      itemCount: cartItems.length,
      totalValue: this.calculateCartTotal(cartItems)
    };

    try {
      await redisCache.setCartSession(customerId, sessionData, this.sessionTimeout);
    } catch (error) {
      console.error('Failed to update cart session in Redis:', error);
      throw new Error('Failed to persist cart session');
    }
  }

  /**
   * Get cart session for customer from Redis
   */
  async getSession(customerId: string): Promise<CartSessionData | null> {
    try {
      const sessionData = await redisCache.getCartSession(customerId);
      return sessionData as CartSessionData | null;
    } catch (error) {
      console.error('Failed to get cart session from Redis:', error);
      return null;
    }
  }

  /**
   * Delete cart session from Redis (e.g., after successful checkout)
   */
  async deleteSession(customerId: string): Promise<boolean> {
    try {
      return await redisCache.deleteCartSession(customerId);
    } catch (error) {
      console.error('Failed to delete cart session from Redis:', error);
      return false;
    }
  }

  /**
   * Check if session exists
   */
  async sessionExists(customerId: string): Promise<boolean> {
    try {
      return await redisCache.exists(customerId, 'cart:session:');
    } catch (error) {
      console.error('Failed to check cart session existence:', error);
      return false;
    }
  }

  /**
   * Get session time to live (TTL) in seconds
   */
  async getSessionTTL(customerId: string): Promise<number> {
    try {
      return await redisCache.ttl(customerId, 'cart:session:');
    } catch (error) {
      console.error('Failed to get cart session TTL:', error);
      return -1;
    }
  }

  /**
   * Extend session expiry time
   */
  async extendSession(customerId: string, additionalSeconds: number = 24 * 60 * 60): Promise<boolean> {
    try {
      return await redisCache.expire(customerId, additionalSeconds, 'cart:session:');
    } catch (error) {
      console.error('Failed to extend cart session:', error);
      return false;
    }
  }

  /**
   * Redis automatically handles expiration, so cleanup is minimal
   * This method can be used for monitoring/reporting
   */
  async cleanupExpiredSessions(): Promise<number> {
    // Redis automatically expires keys, so we don't need to manually clean them up
    // This method can be used for monitoring or manual cleanup if needed
    try {
      // Get all cart session keys (this is expensive, so use sparingly)
      const sessionKeys = await redisCache.keys('*', 'cart:session:');
      return sessionKeys.length; // Return count of active sessions
    } catch (error) {
      console.error('Failed to count cart sessions:', error);
      return 0;
    }
  }

  /**
   * Find abandoned carts for recovery campaigns
   * Note: Since carts are now stored in Redis, this method is simplified
   * In production, you might want to implement a background job that periodically
   * scans active cart sessions and identifies abandoned ones
   */
  async findAbandonedCarts(): Promise<AbandonedCart[]> {
    try {
      // This is a simplified implementation since Redis doesn't have SQL-like queries
      // In a real implementation, you might:
      // 1. Use a background job to scan cart sessions
      // 2. Maintain a separate Redis sorted set for abandoned carts
      // 3. Use Redis streams for real-time abandonment detection

      console.log('Note: Abandoned cart detection with Redis requires background processing');
      return [];
    } catch (error) {
      console.error('Failed to find abandoned carts:', error);
      return [];
    }
  }

  /**
   * Calculate total value of cart items
   */
  private calculateCartTotal(cartItems: any[]): number {
    return cartItems.reduce((total, item) => {
      const price = item.product?.price || item.price || 0;
      const quantity = item.quantity || 1;
      return total + (parseFloat(price) * quantity);
    }, 0);
  }

  /**
   * Delete cart session (e.g., after successful checkout)
   */
  async deleteSession(customerId: string): Promise<boolean> {
    return await this.deleteSession(customerId);
  }
}

export class CartRecoveryManager {
  private recoveryTokenExpiry = 7 * 24 * 60 * 60; // 7 days in seconds for Redis

  /**
   * Generate a secure recovery token
   */
  private generateSecureToken(): string {
    return `recovery_${Date.now()}_${Math.random().toString(36).substr(2, 16)}`;
  }

  /**
   * Create recovery token for abandoned cart
   */
  async createRecoveryToken(customerId: string): Promise<string | null> {
    try {
      // Get current cart items
      const cartItems = await getCartItems(customerId);
      if (cartItems.length === 0) return null;

      const recoveryToken = this.generateSecureToken();

      const cartSnapshot: CartSessionData = {
        items: cartItems,
        lastActivity: new Date(),
        itemCount: cartItems.length,
        totalValue: this.calculateCartTotal(cartItems)
      };

      const recoveryData = {
        customerId,
        recoveryToken,
        cartSnapshot,
        createdAt: new Date(),
        recovered: false
      };

      await redisCache.setCartRecovery(recoveryToken, recoveryData, this.recoveryTokenExpiry);

      return recoveryToken;
    } catch (error) {
      console.error('Failed to create recovery token in Redis:', error);
      return null;
    }
  }

  /**
   * Recover cart from recovery token
   */
  async recoverCart(recoveryToken: string): Promise<any[] | null> {
    try {
      const recoveryData = await redisCache.getCartRecovery(recoveryToken);

      if (!recoveryData || recoveryData.recovered) return null;

      // Mark as recovered and keep for 24 hours after recovery
      const updatedData = {
        ...recoveryData,
        recovered: true,
        recoveredAt: new Date()
      };

      await redisCache.setCartRecovery(recoveryToken, updatedData, 24 * 60 * 60); // 24 hours

      return recoveryData.cartSnapshot.items || [];
    } catch (error) {
      console.error('Failed to recover cart from Redis:', error);
      return null;
    }
  }

  /**
   * Get recovery statistics
   * Note: Redis doesn't support complex aggregations like SQL, so this is a simplified implementation
   */
  async getRecoveryStats(): Promise<{
    totalRecoveries: number;
    successfulRecoveries: number;
    pendingRecoveries: number;
    expiredRecoveries: number;
  }> {
    try {
      // Get all recovery keys (this is expensive for large datasets)
      const recoveryKeys = await redisCache.keys('*', 'cart:recovery:');

      let totalRecoveries = recoveryKeys.length;
      let successfulRecoveries = 0;
      let pendingRecoveries = 0;
      let expiredRecoveries = 0;

      // Note: In production, you might want to maintain separate counters or use a different data structure
      // This implementation is simplified and may not scale well with many recovery tokens

      for (const key of recoveryKeys.slice(0, 100)) { // Limit to first 100 for performance
        try {
          const data = await redisCache.get(key);
          if (!data) continue;

          if (data.recovered) {
            successfulRecoveries++;
          } else {
            const ttl = await redisCache.ttl(key, 'cart:recovery:');
            if (ttl > 0) {
              pendingRecoveries++;
            } else {
              expiredRecoveries++;
            }
          }
        } catch (error) {
          console.error(`Failed to get data for recovery key ${key}:`, error);
        }
      }

      return {
        totalRecoveries,
        successfulRecoveries,
        pendingRecoveries,
        expiredRecoveries
      };
    } catch (error) {
      console.error('Failed to get recovery stats from Redis:', error);
      return {
        totalRecoveries: 0,
        successfulRecoveries: 0,
        pendingRecoveries: 0,
        expiredRecoveries: 0
      };
    }
  }

  /**
   * Generate secure recovery token
   */
  private generateSecureToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Calculate total value of cart items
   */
  private calculateCartTotal(cartItems: any[]): number {
    return cartItems.reduce((total, item) => {
      const price = item.product?.price || item.price || 0;
      const quantity = item.quantity || 1;
      return total + (parseFloat(price) * quantity);
    }, 0);
  }

  /**
   * Clean up expired recovery tokens (Redis does this automatically)
   */
  async cleanupExpiredRecoveries(): Promise<number> {
    // Redis automatically expires keys, so cleanup is minimal
    // This method can be used for monitoring
    try {
      const recoveryKeys = await redisCache.keys('*', 'cart:recovery:');
      return recoveryKeys.length; // Return count of active recovery tokens
    } catch (error) {
      console.error('Failed to count recovery tokens:', error);
      return 0;
    }
  }
}

// Export singleton instances
export const cartSessionManager = new CartSessionManager();
export const cartRecoveryManager = new CartRecoveryManager();
import { getUserId } from "./user";
import { updateCartSession, getCartSession, recoverCart, CartSessionData } from "./api";

export interface CartItem {
  id: string;
  productId: string;
  quantity: number;
  product?: {
    id: string;
    name: string;
    price: string;
    image?: string;
  };
}

export interface CartPersistenceConfig {
  syncIntervalMs?: number;
  enableAutoSync?: boolean;
  enableRecovery?: boolean;
}

export class PersistentCartManager {
  private cartItems: CartItem[] = [];
  private syncInterval: NodeJS.Timeout | null = null;
  private listeners: ((items: CartItem[]) => void)[] = [];
  private config: Required<CartPersistenceConfig>;
  private isInitialized = false;

  constructor(config: CartPersistenceConfig = {}) {
    this.config = {
      syncIntervalMs: 30000, // 30 seconds
      enableAutoSync: true,
      enableRecovery: true,
      ...config
    };

    this.initialize();
  }

  // Initialize the cart manager
  private async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Load persisted cart on initialization
      if (this.config.enableRecovery) {
        await this.loadPersistedCart();
      }

      // Start auto-sync if enabled
      if (this.config.enableAutoSync) {
        this.startAutoSync();
      }

      // Setup page lifecycle events
      this.setupLifecycleEvents();

      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize persistent cart:', error);
    }
  }

  // Get current cart items
  getItems(): CartItem[] {
    return [...this.cartItems];
  }

  // Add item to cart
  addItem(item: CartItem): void {
    const existingIndex = this.cartItems.findIndex(cartItem => cartItem.productId === item.productId);

    if (existingIndex >= 0) {
      this.cartItems[existingIndex].quantity += item.quantity;
    } else {
      this.cartItems.push({ ...item });
    }

    this.notifyListeners();
    this.scheduleSync();
  }

  // Update item quantity
  updateItem(productId: string, quantity: number): void {
    const index = this.cartItems.findIndex(item => item.productId === productId);

    if (index >= 0) {
      if (quantity <= 0) {
        this.cartItems.splice(index, 1);
      } else {
        this.cartItems[index].quantity = quantity;
      }
      this.notifyListeners();
      this.scheduleSync();
    }
  }

  // Remove item from cart
  removeItem(productId: string): void {
    this.cartItems = this.cartItems.filter(item => item.productId !== productId);
    this.notifyListeners();
    this.scheduleSync();
  }

  // Clear cart
  clear(): void {
    this.cartItems = [];
    this.notifyListeners();
    this.scheduleSync();
  }

  // Get cart total
  getTotal(): number {
    return this.cartItems.reduce((total, item) => {
      const price = parseFloat(item.product?.price || '0');
      return total + (price * item.quantity);
    }, 0);
  }

  // Get item count
  getItemCount(): number {
    return this.cartItems.reduce((count, item) => count + item.quantity, 0);
  }

  // Subscribe to cart changes
  subscribe(listener: (items: CartItem[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // Recover cart from token
  async recoverCart(recoveryToken: string): Promise<boolean> {
    try {
      const recoveredItems = await recoverCart(recoveryToken, getUserId());

      if (recoveredItems && recoveredItems.length > 0) {
        // Clear current cart and add recovered items
        this.cartItems = recoveredItems;
        this.notifyListeners();
        this.scheduleSync();

        this.showNotification({
          type: 'success',
          title: 'Cart Recovered!',
          message: `Successfully recovered ${recoveredItems.length} items from your abandoned cart.`,
          duration: 5000
        });

        return true;
      }
    } catch (error) {
      console.error('Cart recovery failed:', error);
      this.showNotification({
        type: 'error',
        title: 'Recovery Failed',
        message: 'Unable to recover your cart. The recovery link may have expired.',
        duration: 5000
      });
    }

    return false;
  }

  // Load persisted cart from server
  private async loadPersistedCart(): Promise<void> {
    try {
      const customerId = getUserId();
      const session = await getCartSession(customerId);

      if (session && session.items && session.items.length > 0) {
        this.cartItems = session.items;

        // Show recovery notification if cart was restored
        this.showNotification({
          type: 'info',
          title: 'Cart Restored',
          message: `We restored ${session.items.length} item(s) from your previous session.`,
          duration: 5000
        });

        this.notifyListeners();
      }
    } catch (error) {
      console.error('Failed to load persisted cart:', error);
    }
  }

  // Start automatic syncing
  private startAutoSync(): void {
    this.syncInterval = setInterval(() => {
      this.syncToServer();
    }, this.config.syncIntervalMs);
  }

  // Schedule immediate sync
  private scheduleSync(): void {
    if (this.config.enableAutoSync) {
      // Debounce sync calls
      setTimeout(() => this.syncToServer(), 1000);
    }
  }

  // Sync cart to server
  private async syncToServer(): Promise<void> {
    try {
      const customerId = getUserId();
      if (this.cartItems.length > 0) {
        await updateCartSession(customerId, this.cartItems);
      }
    } catch (error) {
      console.error('Failed to sync cart to server:', error);
    }
  }

  // Setup page lifecycle events
  private setupLifecycleEvents(): void {
    // Sync on page unload
    window.addEventListener('beforeunload', () => {
      this.syncToServer();
    });

    // Sync on page visibility change
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.syncToServer();
      }
    });

    // Sync on page focus (user returns to tab)
    window.addEventListener('focus', () => {
      this.loadPersistedCart(); // Refresh from server
    });
  }

  // Notify listeners of cart changes
  private notifyListeners(): void {
    this.listeners.forEach(listener => listener([...this.cartItems]));
  }

  // Show notification (implement based on your UI framework)
  private showNotification(notification: {
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message: string;
    duration?: number;
  }): void {
    // This should integrate with your notification system
    // For now, just console log
    console.log(`[${notification.type.toUpperCase()}] ${notification.title}: ${notification.message}`);

    // You could dispatch a custom event or use a global notification system
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cart-notification', {
        detail: notification
      }));
    }
  }

  // Cleanup
  destroy(): void {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.listeners = [];
    this.cartItems = [];
  }
}

// Global cart manager instance
export const persistentCartManager = new PersistentCartManager({
  syncIntervalMs: 30000, // 30 seconds
  enableAutoSync: true,
  enableRecovery: true
});

// Utility functions for cart operations
export function addToPersistentCart(item: CartItem): void {
  persistentCartManager.addItem(item);
}

export function updatePersistentCartItem(productId: string, quantity: number): void {
  persistentCartManager.updateItem(productId, quantity);
}

export function removeFromPersistentCart(productId: string): void {
  persistentCartManager.removeItem(productId);
}

export function clearPersistentCart(): void {
  persistentCartManager.clear();
}

export function getPersistentCartItems(): CartItem[] {
  return persistentCartManager.getItems();
}

export function getPersistentCartTotal(): number {
  return persistentCartManager.getTotal();
}

export function getPersistentCartItemCount(): number {
  return persistentCartManager.getItemCount();
}

// Subscribe to cart changes
export function subscribeToCartChanges(callback: (items: CartItem[]) => void): () => void {
  return persistentCartManager.subscribe(callback);
}
"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { wsClient, CartUpdateMessage } from "@/src/lib/websocket";
import { getCart } from "@/src/lib/api";
import { logger } from "@/src/lib/logger";

interface CartItem {
  id: string;
  productId: string;
  product: {
    id: string;
    name: string;
    price: string;
    image?: string;
  };
  quantity: number;
}

interface RealTimeCartProps {
  onCartUpdate?: (cartItems: CartItem[]) => void;
  showToast?: boolean;
}

export default function RealTimeCart({ onCartUpdate, showToast = true }: RealTimeCartProps) {
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<{ action: string; productId?: string; quantity?: number; timestamp: number } | null>(null);
  const router = useRouter();

  const loadCart = useCallback(async () => {
    try {
      const response = await getCart();
      const items = response.data || [];
      setCartItems(items);

      if (onCartUpdate) {
        onCartUpdate(items);
      }
    } catch (error) {
      logger.error('Failed to load cart', error);
    } finally {
      setLoading(false);
    }
  }, [onCartUpdate]);

  useEffect(() => {
    // Load initial cart
    loadCart();

    // Subscribe to cart updates
    const handleCartUpdate = (message: CartUpdateMessage) => {
      logger.info('Received cart update', {
        action: message.action,
        productId: message.productId,
        quantity: message.quantity,
      });

      setLastUpdate({
        action: message.action,
        productId: message.productId,
        quantity: message.quantity,
        timestamp: message.timestamp,
      });

      // Reload cart data to get latest state
      loadCart();

      // Show toast notification if enabled
      if (showToast) {
        showCartToast(message);
      }

      // Clear update indicator after 3 seconds
      setTimeout(() => setLastUpdate(null), 3000);
    };

    // Subscribe to user-specific cart updates
    const userId = localStorage.getItem('user_id'); // You might need to get this from auth context
    if (userId) {
      wsClient.subscribe([`user:${userId}`]);
      wsClient.authenticate(userId);
    }

    wsClient.onMessage('cart_update', handleCartUpdate);

    // Cleanup
    return () => {
      wsClient.offMessage('cart_update', handleCartUpdate);
    };
  }, [loadCart, showToast]);

  const showCartToast = (message: CartUpdateMessage) => {
    const action = message.action;
    let toastMessage = '';

    switch (action) {
      case 'add':
        toastMessage = `Added item to cart`;
        break;
      case 'remove':
        toastMessage = `Removed item from cart`;
        break;
      case 'update':
        toastMessage = `Updated cart item`;
        break;
      case 'clear':
        toastMessage = `Cart cleared`;
        break;
      default:
        toastMessage = `Cart updated`;
    }

    // You can integrate with your toast system here
    // For now, we'll use a simple alert
    if (typeof window !== 'undefined' && 'showToast' in window === false) {
      // Fallback to console if no toast system
      console.log('Cart Update:', toastMessage);
    }
  };

  const getTotalItems = () => {
    return cartItems.reduce((sum, item) => sum + item.quantity, 0);
  };

  const getTotalPrice = () => {
    return cartItems.reduce((sum, item) => {
      return sum + (parseFloat(item.product.price) * item.quantity);
    }, 0);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-4">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div>
        <span className="ml-2 text-sm text-gray-600">Loading cart...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Real-time update indicator */}
      {lastUpdate && (
        <div className="bg-green-50 border border-green-200 rounded-md p-3">
          <div className="flex items-center">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse mr-2"></div>
            <span className="text-sm text-green-800">
              Cart updated • {new Date(lastUpdate.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      )}

      {/* Cart summary */}
      <div className="bg-white rounded-lg shadow p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900">
            Shopping Cart ({getTotalItems()} items)
          </h3>
          <button
            onClick={() => router.push('/cart')}
            className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
          >
            View Cart →
          </button>
        </div>

        {cartItems.length === 0 ? (
          <p className="text-gray-500 text-center py-4">Your cart is empty</p>
        ) : (
          <div className="space-y-3">
            {cartItems.slice(0, 3).map((item) => (
              <div key={item.id} className="flex items-center space-x-3">
                <div className="w-12 h-12 bg-gray-200 rounded-md flex-shrink-0">
                  {item.product.image && (
                    <img
                      src={item.product.image}
                      alt={item.product.name}
                      className="w-full h-full object-cover rounded-md"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {item.product.name}
                  </p>
                  <p className="text-sm text-gray-500">
                    Qty: {item.quantity} × ${item.product.price}
                  </p>
                </div>
                <div className="text-sm font-medium text-gray-900">
                  ${(parseFloat(item.product.price) * item.quantity).toFixed(2)}
                </div>
              </div>
            ))}

            {cartItems.length > 3 && (
              <p className="text-sm text-gray-500 text-center">
                +{cartItems.length - 3} more items
              </p>
            )}

            <div className="border-t pt-3">
              <div className="flex items-center justify-between">
                <span className="text-base font-medium text-gray-900">Total</span>
                <span className="text-base font-medium text-gray-900">
                  ${getTotalPrice().toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
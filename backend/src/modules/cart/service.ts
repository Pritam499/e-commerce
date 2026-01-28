import { eq, and } from "drizzle-orm";
import { db } from "../../lib/db";
import { cartItems, products, customers } from "../../drizzle/schema";
import type { AddToCartInput } from "./schema";
import { emitEvent, createEvent } from "../events/emitter";
import { EVENT_TYPES } from "../events/types";

// Import CartSessionManager dynamically to avoid circular dependency
let cartSessionManager: any = null;
async function getCartSessionManager() {
  if (!cartSessionManager) {
    const { CartSessionManager } = await import("../cart-persistence/service");
    cartSessionManager = new CartSessionManager();
  }
  return cartSessionManager;
}

async function ensureCustomerExists(customerId: string) {
  let customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
  });

  if (!customer) {
    // Create customer with UUID
    await db.insert(customers).values({
      id: customerId,
      name: `Customer ${customerId.substring(0, 8)}`,
      email: `customer-${customerId}@example.com`,
    }).onConflictDoNothing();
    
    // Verify customer was created
    customer = await db.query.customers.findFirst({
      where: eq(customers.id, customerId),
    });
  }

  return customer;
}

/**
 * Add item to cart or update quantity if item already exists
 */
export async function addToCart(input: AddToCartInput) {
  const { productId, quantity } = input;
  if (!input.customerId) {
    throw new Error("Customer ID is required");
  }
  const customerId = input.customerId;

  // Ensure customer exists
  await ensureCustomerExists(customerId);

  // Check if product exists and is available
  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
  });

  if (!product) {
    throw new Error("Product not found");
  }

  if (product.stock < quantity) {
    throw new Error("Insufficient stock");
  }

  // Get cart session manager
  const sessionManager = await getCartSessionManager();

  // Get current cart from Redis session
  let currentCartItems = [];
  try {
    const sessionData = await sessionManager.getSession(customerId);
    currentCartItems = sessionData?.items || [];
  } catch (error) {
    console.error('Failed to get cart session:', error);
    // Continue with empty cart if session retrieval fails
  }

  // Find existing item in cart
  const existingItemIndex = currentCartItems.findIndex(item => item.productId === productId);

  let finalQuantity;

  if (existingItemIndex >= 0) {
    // Update quantity of existing item
    finalQuantity = currentCartItems[existingItemIndex].quantity + quantity;
    if (product.stock < finalQuantity) {
      throw new Error("Insufficient stock");
    }

    currentCartItems[existingItemIndex].quantity = finalQuantity;
    currentCartItems[existingItemIndex].updatedAt = new Date();
  } else {
    // Add new item to cart
    finalQuantity = quantity;
    currentCartItems.push({
      productId,
      quantity,
      product, // Include product data for easier access
      addedAt: new Date(),
      updatedAt: new Date()
    });
  }

  // Update cart session in Redis
  try {
    await sessionManager.updateSession(customerId, currentCartItems);
  } catch (error) {
    console.error('Failed to update cart session:', error);
    throw new Error('Failed to persist cart changes');
  }

  const result = {
    id: `${customerId}_${productId}`, // Generate consistent ID for frontend compatibility
    customerId,
    productId,
    quantity: finalQuantity,
  };

  // Emit cart item added event
  try {
    const totalValue = currentCartItems.reduce((sum, item) => {
      return sum + (parseFloat(item.product?.price || '0') * item.quantity);
    }, 0);

    await emitEvent(createEvent(EVENT_TYPES.CART_ITEM_ADDED, {
      customerId,
      productId,
      quantity: finalQuantity,
      cartTotal: totalValue
    }, {
      source: 'cart-service',
      userId: customerId,
      customMetadata: {
        productId,
        addedQuantity: quantity,
        finalQuantity,
        totalCartValue: totalValue
      }
    }));
  } catch (error) {
    // Don't fail the cart operation if event emission fails
    console.error('Failed to emit cart item added event:', error);
  }

  return result;
}

/**
 * Get cart items for a customer from Redis session
 */
export async function getCartItems(customerId: string) {
  try {
    const sessionManager = await getCartSessionManager();
    const sessionData = await sessionManager.getSession(customerId);
    const cartItems = sessionData?.items || [];

    // Enrich cart items with full product data (since Redis stores minimal data)
    const enrichedItems = await Promise.all(
      cartItems.map(async (item) => {
        // Get full product data from database
        const product = await db.query.products.findFirst({
          where: eq(products.id, item.productId),
          with: {
            category: true,
          },
        });

        return {
          id: `${customerId}_${item.productId}`, // Generate consistent ID
          customerId,
          productId: item.productId,
          quantity: item.quantity,
          product,
          addedAt: item.addedAt || new Date(),
          updatedAt: item.updatedAt || new Date(),
        };
      })
    );

    return enrichedItems;
  } catch (error) {
    console.error('Failed to get cart items from Redis:', error);
    return [];
  }
}

/**
 * Update cart item quantity
 */
export async function updateCartItem(cartItemId: string, quantity: number, customerId: string) {
  // Parse productId from cartItemId (format: customerId_productId)
  const productId = cartItemId.split('_').slice(1).join('_');

  if (!productId) {
    throw new Error("Invalid cart item ID format");
  }

  // Get cart session manager
  const sessionManager = await getCartSessionManager();

  // Get current cart from Redis
  const sessionData = await sessionManager.getSession(customerId);
  const currentCartItems = sessionData?.items || [];

  // Find the item in the cart
  const itemIndex = currentCartItems.findIndex(item => item.productId === productId);

  if (itemIndex === -1) {
    throw new Error("Cart item not found");
  }

  // Get product data for stock validation
  const product = await db.query.products.findFirst({
    where: eq(products.id, productId),
  });

  if (!product) {
    throw new Error("Product not found for this cart item");
  }

  if (quantity === 0) {
    // Remove item if quantity is 0
    currentCartItems.splice(itemIndex, 1);
  } else {
    // Check stock availability
    if (product.stock < quantity) {
      throw new Error(`Insufficient stock. Available: ${product.stock}, Requested: ${quantity}`);
    }

    // Update quantity
    currentCartItems[itemIndex].quantity = quantity;
    currentCartItems[itemIndex].updatedAt = new Date();
  }

  // Update cart session in Redis
  try {
    await sessionManager.updateSession(customerId, currentCartItems);
  } catch (error) {
    console.error('Failed to update cart session:', error);
    throw new Error('Failed to persist cart changes');
  }

  // Emit cart item updated event
  try {
    const totalValue = currentCartItems.reduce((sum, item) => {
      return sum + (parseFloat(item.product?.price || '0') * item.quantity);
    }, 0);

    await emitEvent(createEvent(EVENT_TYPES.CART_ITEM_UPDATED, {
      customerId,
      productId,
      quantity,
      cartTotal: totalValue
    }, {
      source: 'cart-service',
      userId: customerId,
      customMetadata: {
        productId,
        newQuantity: quantity,
        totalCartValue: totalValue
      }
    }));
  } catch (error) {
    console.error('Failed to emit cart item updated event:', error);
  }

  return {
    id: cartItemId,
    quantity,
  };
}

/**
 * Remove cart item
 */
export async function removeCartItem(cartItemId: string, customerId: string) {
  // Parse productId from cartItemId (format: customerId_productId)
  const productId = cartItemId.split('_').slice(1).join('_');

  if (!productId) {
    throw new Error("Invalid cart item ID format");
  }

  // Get cart session manager
  const sessionManager = await getCartSessionManager();

  // Get current cart from Redis
  const sessionData = await sessionManager.getSession(customerId);
  const currentCartItems = sessionData?.items || [];

  // Find and remove the item
  const itemIndex = currentCartItems.findIndex(item => item.productId === productId);

  if (itemIndex === -1) {
    throw new Error("Cart item not found");
  }

  currentCartItems.splice(itemIndex, 1);

  // Update cart session in Redis
  try {
    await sessionManager.updateSession(customerId, currentCartItems);
  } catch (error) {
    console.error('Failed to update cart session:', error);
    throw new Error('Failed to persist cart changes');
  }

  // Emit cart item removed event
  try {
    const totalValue = currentCartItems.reduce((sum, item) => {
      return sum + (parseFloat(item.product?.price || '0') * item.quantity);
    }, 0);

    await emitEvent(createEvent(EVENT_TYPES.CART_ITEM_REMOVED, {
      customerId,
      productId,
      cartTotal: totalValue
    }, {
      source: 'cart-service',
      userId: customerId,
      customMetadata: {
        productId,
        totalCartValue: totalValue
      }
    }));
  } catch (error) {
    console.error('Failed to emit cart item removed event:', error);
  }

  return { success: true };
}

/**
 * Clear cart for a customer
 */
export async function clearCart(customerId: string) {
  try {
    // Clear cart session in Redis by setting empty cart
    await cartSessionManager.updateSession(customerId, []);

    // Emit cart cleared event
    await emitEvent(createEvent(EVENT_TYPES.CART_CLEARED, {
      customerId,
      cartTotal: 0
    }, {
      source: 'cart-service',
      userId: customerId,
      customMetadata: {
        totalCartValue: 0
      }
    }));
  } catch (error) {
    console.error('Failed to clear cart session:', error);
    throw new Error('Failed to clear cart');
  }
}

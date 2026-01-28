import { eq, and } from "drizzle-orm";
import { db } from "../../lib/db";
import { cartItems, products, customers, users } from "../../drizzle/schema";
import type { AddToCartInput } from "./schema";
import { createId } from "@paralleldrive/cuid2";
import { randomUUID } from "crypto";
import { encryptObject } from "../../lib/encryption";
import { logger } from "../../lib/logger";
import { wsService } from "../../lib/websocket-service";

async function ensureCustomerExists(userId: string) {
  let customer = await db.query.customers.findFirst({
    where: eq(customers.userId, userId),
  });

  if (!customer) {
    // Get user details
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error("User not found");
    }

    // Encrypt sensitive customer data
    const encryptedData = encryptObject({
      name: user.name,
      email: user.email,
    });

    logger.database('INSERT', 'customers', { userId, customerId: 'new' });

    await db.insert(customers).values({
      id: randomUUID(), // Generate new UUID for customer
      userId: userId,
      name: encryptedData.name,
      email: encryptedData.email,
    });

    customer = await db.query.customers.findFirst({
      where: eq(customers.userId, userId),
    });
  }

  if (!customer) {
    throw new Error("Failed to create customer");
  }

  return customer;
}

/**
 * Add item to cart or update quantity if item already exists
 */
export async function addToCart(input: AddToCartInput, userId: string) {
  const { productId, quantity } = input;

  // Ensure customer exists
  const customer = await ensureCustomerExists(userId);

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

  // Check if item already exists in cart
  const existingCartItem = await db.query.cartItems.findFirst({
    where: and(
      eq(cartItems.customerId, customer.id),
      eq(cartItems.productId, productId)
    ),
  });

  if (existingCartItem) {
    // Update quantity
    const newQuantity = existingCartItem.quantity + quantity;
    if (product.stock < newQuantity) {
      throw new Error("Insufficient stock");
    }

    await db
      .update(cartItems)
      .set({
        quantity: newQuantity,
        updatedAt: new Date(),
      })
      .where(eq(cartItems.id, existingCartItem.id));

    // Broadcast cart update
    wsService.broadcastCartUpdate({
      userId,
      action: 'update',
      productId,
      quantity: newQuantity - existingCartItem.quantity, // Quantity change
    });

    return {
      id: existingCartItem.id,
      customerId: customer.id,
      productId,
      quantity: newQuantity,
    };
  } else {
    // Create new cart item
    const [newCartItem] = await db
      .insert(cartItems)
      .values({
        customerId: customer.id,
        productId,
        quantity,
      })
      .returning();

    return newCartItem;
  }

  // Broadcast cart update
  wsService.broadcastCartUpdate({
    userId,
    action: 'add',
    productId: input.productId,
    quantity: input.quantity,
  });
}

/**
 * Get cart items for a customer
 */
export async function getCartItems(userId: string) {
  // Find customer by userId
  const customer = await ensureCustomerExists(userId);

  const items = await db.query.cartItems.findMany({
    where: eq(cartItems.customerId, customer.id),
    with: {
      product: {
        with: {
          category: true,
        },
      },
    },
  });

  return items;
}

/**
 * Update cart item quantity
 */
export async function updateCartItem(cartItemId: string, quantity: number, userId: string) {
  // Find customer by userId
  const customer = await ensureCustomerExists(userId);

  const cartItem = await db.query.cartItems.findFirst({
    where: and(
      eq(cartItems.id, cartItemId),
      eq(cartItems.customerId, customer.id)
    ),
    with: {
      product: true,
    },
  });

  if (!cartItem) {
    throw new Error("Cart item not found");
  }

  if (!cartItem.product) {
    throw new Error("Product not found for this cart item");
  }

  if (quantity === 0) {
    // Remove item if quantity is 0
    await db.delete(cartItems).where(eq(cartItems.id, cartItemId));
    return null;
  }

  // Check stock availability - handle both number and string types
  // Stock is stored as integer in DB, but might come as string from query
  const productStock = typeof cartItem.product.stock === 'string' 
    ? parseInt(cartItem.product.stock, 10) 
    : Number(cartItem.product.stock);
  
  if (isNaN(productStock) || productStock < quantity) {
    throw new Error(`Insufficient stock. Available: ${productStock}, Requested: ${quantity}`);
  }

  await db
    .update(cartItems)
    .set({
      quantity,
      updatedAt: new Date(),
    })
    .where(eq(cartItems.id, cartItemId));

  return {
    id: cartItemId,
    quantity,
  };
}

/**
 * Remove cart item
 */
export async function removeCartItem(cartItemId: string, userId: string) {
  // Find customer by userId
  const customer = await ensureCustomerExists(userId);

  const cartItem = await db.query.cartItems.findFirst({
    where: and(
      eq(cartItems.id, cartItemId),
      eq(cartItems.customerId, customer.id)
    ),
  });

  if (!cartItem) {
    throw new Error("Cart item not found");
  }

  // Broadcast cart update before deletion
  wsService.broadcastCartUpdate({
    userId,
    action: 'remove',
    productId: cartItem.productId,
    quantity: cartItem.quantity,
  });

  await db.delete(cartItems).where(eq(cartItems.id, cartItemId));
  return { success: true };
}

/**
 * Clear cart for a customer
 */
export async function clearCart(userId: string) {
  // Find customer by userId
  const customer = await ensureCustomerExists(userId);

  // Broadcast cart clear
  wsService.broadcastCartUpdate({
    userId,
    action: 'clear',
  });

  await db.delete(cartItems).where(eq(cartItems.customerId, customer.id));
}

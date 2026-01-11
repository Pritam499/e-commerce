import { eq, and } from "drizzle-orm";
import { db } from "../../lib/db";
import { cartItems, products, customers } from "../../drizzle/schema";
import type { AddToCartInput } from "./schema";

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

  // Check if item already exists in cart
  const existingCartItem = await db.query.cartItems.findFirst({
    where: and(
      eq(cartItems.customerId, customerId),
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

    return {
      id: existingCartItem.id,
      customerId,
      productId,
      quantity: newQuantity,
    };
  } else {
    // Create new cart item
    const [newCartItem] = await db
      .insert(cartItems)
      .values({
        customerId,
        productId,
        quantity,
      })
      .returning();

    return newCartItem;
  }
}

/**
 * Get cart items for a customer
 */
export async function getCartItems(customerId: string) {
  const items = await db.query.cartItems.findMany({
    where: eq(cartItems.customerId, customerId),
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
export async function updateCartItem(cartItemId: string, quantity: number, customerId: string) {
  const cartItem = await db.query.cartItems.findFirst({
    where: and(
      eq(cartItems.id, cartItemId),
      eq(cartItems.customerId, customerId)
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
export async function removeCartItem(cartItemId: string, customerId: string) {
  const cartItem = await db.query.cartItems.findFirst({
    where: and(
      eq(cartItems.id, cartItemId),
      eq(cartItems.customerId, customerId)
    ),
  });

  if (!cartItem) {
    throw new Error("Cart item not found");
  }

  await db.delete(cartItems).where(eq(cartItems.id, cartItemId));
  return { success: true };
}

/**
 * Clear cart for a customer
 */
export async function clearCart(customerId: string) {
  await db.delete(cartItems).where(eq(cartItems.customerId, customerId));
}

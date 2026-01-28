import { eq, and, inArray } from "drizzle-orm";
import { db } from "../../lib/db";
import { orders, orderItems, cartItems, products, customers, users } from "../../drizzle/schema";
import type { CheckoutInput } from "./schema";
import { validateDiscountCode, applyDiscountCode } from "../discount/service";
import { getCartItems, clearCart } from "../cart/service";
import { checkAndGenerateDiscountCode } from "../discount/service";
import { createId } from "@paralleldrive/cuid2";
import { randomUUID } from "crypto";
import { encryptObject } from "../../lib/encryption";
import { logger } from "../../lib/logger";
import { inventoryService } from "../../lib/inventory-service";
import { wsService } from "../../lib/websocket-service";

async function ensureCustomerExists(userId: string) {
  // Since userId is now from authenticated user, we need to find or create a customer linked to the user
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

export async function checkout(input: CheckoutInput, userId: string) {
  const { discountCode } = input;

  // Ensure customer exists and get customer object
  const customer = await ensureCustomerExists(userId);

  // Get cart items
  const cartItemsList = await getCartItems(userId);

  if (cartItemsList.length === 0) {
    throw new Error("Cart is empty");
  }

  logger.info('Starting checkout process', { userId, itemCount: cartItemsList.length });

  // Check inventory availability and reserve stock
  const reservationItems = cartItemsList.map(item => ({
    productId: item.productId,
    quantity: item.quantity,
  }));

  const reservationResult = await inventoryService.reserveInventory(
    `temp_${Date.now()}`, // Temporary order ID for reservation
    userId,
    reservationItems
  );

  if (!reservationResult.success) {
    const failedItems = reservationResult.failedItems;
    logger.warn('Checkout failed - insufficient inventory', {
      userId,
      failedItems: failedItems.map(f => `${f.productId}: requested ${f.requested}, available ${f.available}`)
    });

    throw new Error(
      `Insufficient stock for: ${failedItems.map(f => `${f.productId} (${f.available} available)`).join(', ')}`
    );
  }

  // Calculate subtotal
  let subtotal = 0;
  const orderItemsData = [];

  for (const cartItem of cartItemsList) {
    const product = cartItem.product;
    const itemTotal = Number(product.price) * cartItem.quantity;
    subtotal += itemTotal;

    orderItemsData.push({
      productId: product.id,
      quantity: cartItem.quantity,
      price: product.price,
    });
  }

  // Validate and apply discount code if provided
  let discountAmount = 0;
  let discountCodeId: string | null = null;

  if (discountCode) {
    const discount = await validateDiscountCode(discountCode, userId);
    if (!discount) {
      throw new Error("Invalid or unavailable discount code");
    }

    discountCodeId = discount.id;
    discountAmount = (subtotal * discount.discountPercentage) / 100;
    await applyDiscountCode(discount.id);
  }

  const total = subtotal - discountAmount;

  // Create order
  const [order] = await db
    .insert(orders)
    .values({
      customerId: customer.id,
      discountCodeId,
      subtotal: subtotal.toString(),
      discountAmount: discountAmount.toString(),
      total: total.toString(),
      status: "pending", // Start as pending, will be completed after inventory commit
    })
    .returning();

  // Create order items
  for (const item of orderItemsData) {
    await db.insert(orderItems).values({
      orderId: order.id,
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
    });
  }

  try {
    // Commit inventory reservations (this will reduce actual stock)
    await inventoryService.commitReservation(order.id);

    // Update order status to completed
    await db.update(orders)
      .set({
        status: "completed",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    // Broadcast order status update
    wsService.broadcastOrderStatusUpdate({
      orderId: order.id,
      previousStatus: "pending",
      newStatus: "completed",
      userId,
    });

    logger.info('Order completed successfully', {
      orderId: order.id,
      userId,
      total: total.toString(),
      itemCount: orderItemsData.length,
    });

  } catch (error) {
    // If inventory commit fails, mark order as failed and cleanup
    await db.update(orders)
      .set({
        status: "failed",
        updatedAt: new Date(),
      })
      .where(eq(orders.id, order.id));

    // Cancel reservations
    await inventoryService.cancelReservation(order.id);

    logger.error('Order failed during inventory commit', {
      orderId: order.id,
      userId,
      error: error.message,
    });

    throw new Error('Failed to complete order due to inventory issues');
  }

  // Clear cart
  await clearCart(userId);

  // Calculate per-customer order number for this order
  // Get all orders for this customer (including the one just created) sorted by creation date
  const customerOrders = await db.query.orders.findMany({
    where: eq(orders.customerId, customer.id),
    orderBy: (orders, { asc }) => [asc(orders.createdAt)],
  });
  // Find the index of the current order to get its order number (1-based)
  const orderIndex = customerOrders.findIndex((o) => o.id === order.id);
  const orderNumber = orderIndex >= 0 ? orderIndex + 1 : customerOrders.length;

  // Check if nth order condition is met and generate discount code for this customer
  // NOTE: Discount is based on COMPLETED ORDERS (checkouts), not products in cart
  // A cart with multiple products becomes ONE order when checked out
  // So 3 products in cart → 1 order, not 3 orders
  // Discount is generated on 3rd, 6th, 9th... completed order (not 3rd product)
  await checkAndGenerateDiscountCode(userId);

  return {
    ...order,
    orderNumber, // Include per-customer order number in response
  };
}

/**
 * Get order by ID
 */
export async function getOrder(orderId: string, userId?: string) {
  const order = await db.query.orders.findFirst({
    where: eq(orders.id, orderId),
    with: {
      customer: true,
      discountCode: true,
      orderItems: {
        with: {
          product: {
            with: {
              category: true,
            },
          },
        },
      },
    },
  });

  if (!order) {
    return null;
  }

  // If userId is provided, ensure the order belongs to the user
  if (userId && order.customerId !== userId) {
    return null;
  }

  // Calculate per-customer order number
  const customerOrders = await db.query.orders.findMany({
    where: eq(orders.customerId, order.customerId),
    orderBy: (orders, { asc }) => [asc(orders.createdAt)],
  });

  const orderIndex = customerOrders.findIndex((o) => o.id === orderId);
  const orderNumber = orderIndex >= 0 ? orderIndex + 1 : null;

  return {
    ...order,
    orderNumber,
  };
}

/**
 * Get all orders for a customer
 */
export async function getAllOrders(userId: string) {
  // Find customer by userId
  const customer = await ensureCustomerExists(userId);

  const ordersList = await db.query.orders.findMany({
    where: eq(orders.customerId, customer.id),
    with: {
      customer: true,
      discountCode: true,
      orderItems: {
        with: {
          product: true,
        },
      },
    },
    orderBy: (orders, { asc }) => [asc(orders.createdAt)], // Sort by oldest first to calculate order numbers
  });

  // Add per-customer order number (1, 2, 3, etc.)
  const ordersWithNumbers = ordersList.map((order, index) => ({
    ...order,
    orderNumber: index + 1, // Customer's 1st, 2nd, 3rd order, etc.
  }));

  // Return sorted by newest first (for display)
  return ordersWithNumbers.reverse();
}

// Cancel an order (before it's shipped)
export async function cancelOrder(orderId: string, userId: string, reason?: string): Promise<void> {
  // Find the order
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));

  if (!order) {
    throw new Error('Order not found');
  }

  // Verify ownership
  const customer = await ensureCustomerExists(userId);
  if (order.customerId !== customer.id) {
    throw new Error('Access denied');
  }

  // Only allow cancellation of pending or processing orders
  if (!['pending', 'processing'].includes(order.status)) {
    throw new Error('Order cannot be cancelled at this stage');
  }

  const previousStatus = order.status;

  // Update order status
  await db.update(orders)
    .set({
      status: 'cancelled',
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  // Return inventory
  const orderItemsList = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  const returnItems = orderItemsList.map(item => ({
    productId: item.productId,
    quantity: item.quantity,
    reason: reason || 'Order cancelled',
  }));

  await inventoryService.returnItems(orderId, returnItems);

  // Broadcast order status update
  wsService.broadcastOrderStatusUpdate({
    orderId,
    previousStatus,
    newStatus: 'cancelled',
    userId,
  });

  logger.info('Order cancelled', {
    orderId,
    userId,
    previousStatus,
    reason,
    itemsReturned: returnItems.length,
  });
}

// Return items from a completed order
export async function returnOrderItems(
  orderId: string,
  userId: string,
  returns: Array<{
    productId: string;
    quantity: number;
    reason: string;
  }>
): Promise<void> {
  // Find the order
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));

  if (!order) {
    throw new Error('Order not found');
  }

  // Verify ownership
  const customer = await ensureCustomerExists(userId);
  if (order.customerId !== customer.id) {
    throw new Error('Access denied');
  }

  // Only allow returns for completed orders
  if (order.status !== 'completed') {
    throw new Error('Items can only be returned from completed orders');
  }

  // Validate return quantities against order items
  const orderItemsList = await db.select().from(orderItems).where(eq(orderItems.orderId, orderId));

  for (const returnItem of returns) {
    const orderItem = orderItemsList.find(item => item.productId === returnItem.productId);
    if (!orderItem) {
      throw new Error(`Product ${returnItem.productId} not found in order`);
    }
    if (returnItem.quantity > orderItem.quantity) {
      throw new Error(`Cannot return more than ordered quantity for product ${returnItem.productId}`);
    }
  }

  // Process returns
  await inventoryService.returnItems(orderId, returns);

  // Update order status if all items are returned
  const totalOrdered = orderItemsList.reduce((sum, item) => sum + item.quantity, 0);
  const totalReturned = returns.reduce((sum, item) => sum + item.quantity, 0);

  if (totalReturned >= totalOrdered) {
    const previousStatus = order.status;
    await db.update(orders)
      .set({
        status: 'returned',
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    // Broadcast order status update
    wsService.broadcastOrderStatusUpdate({
      orderId,
      previousStatus,
      newStatus: 'returned',
      userId,
    });
  }

  logger.info('Order items returned', {
    orderId,
    userId,
    returns: returns.map(r => `${r.productId}: ${r.quantity} (${r.reason})`),
  });
}

// Update order status (for admin or system updates)
export async function updateOrderStatus(
  orderId: string,
  newStatus: string,
  userId?: string
): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));

  if (!order) {
    throw new Error('Order not found');
  }

  const previousStatus = order.status;

  // Update status
  await db.update(orders)
    .set({
      status: newStatus,
      updatedAt: new Date(),
    })
    .where(eq(orders.id, orderId));

  // Broadcast status update
  wsService.broadcastOrderStatusUpdate({
    orderId,
    previousStatus,
    newStatus,
    userId: userId || order.customerId,
  });

  logger.info('Order status updated', {
    orderId,
    previousStatus,
    newStatus,
    updatedBy: userId,
  });
}

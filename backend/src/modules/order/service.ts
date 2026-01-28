import { eq, sql, inArray } from "drizzle-orm";
import { db } from "../../lib/db";
import { orders, orderItems, cartItems, products, customers, discountCodes, categories } from "../../drizzle/schema";
import type { CheckoutInput } from "./schema";
import { validateDiscountCode, applyDiscountCode } from "../discount/service";
import { getCartItems, clearCart } from "../cart/service";
import { checkAndGenerateDiscountCode } from "../discount/service";
import { cartSessionManager } from "../cart-persistence/service";
import { jobProducer } from "../queue/producer";
import type { UpdateInventoryJobData, SendOrderConfirmationJobData } from "../queue/types";

async function ensureCustomerExists(customerId: string) {
  // Try to find customer
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
    
    customer = await db.query.customers.findFirst({
      where: eq(customers.id, customerId),
    });
  }

  return customer;
}

export async function checkout(input: CheckoutInput) {
  const { discountCode } = input;
  if (!input.customerId) {
    throw new Error("Customer ID is required");
  }
  const customerId = input.customerId;

  // Use database transaction to ensure atomicity and prevent race conditions
  return await db.transaction(async (tx) => {
    // Ensure customer exists within transaction
    let customer = await tx.query.customers.findFirst({
      where: eq(customers.id, customerId),
    });

    if (!customer) {
      // Create customer with UUID within transaction
      await tx.insert(customers).values({
        id: customerId,
        name: `Customer ${customerId.substring(0, 8)}`,
        email: `customer-${customerId}@example.com`,
      }).onConflictDoNothing();

      customer = await tx.query.customers.findFirst({
        where: eq(customers.id, customerId),
      });
    }

    // Optimized query: Get cart items with product data and lock products in a single JOIN query
    const cartItemsWithProducts = await tx
      .select({
        cartItemId: cartItems.id,
        productId: cartItems.productId,
        quantity: cartItems.quantity,
        productName: products.name,
        productPrice: products.price,
        productStock: products.stock,
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .where(eq(cartItems.customerId, customerId))
      .for("update"); // Lock both cart_items and products rows

    if (cartItemsWithProducts.length === 0) {
      throw new Error("Cart is empty");
    }

    // Calculate subtotal and validate stock in a single pass
    let subtotal = 0;
    const orderItemsData = [];
    const insufficientStockProducts = [];

    for (const cartItem of cartItemsWithProducts) {
      // Check stock availability with locked data
      if (cartItem.productStock < cartItem.quantity) {
        insufficientStockProducts.push({
          name: cartItem.productName,
          available: cartItem.productStock,
          requested: cartItem.quantity,
        });
      }

      const itemTotal = Number(cartItem.productPrice) * cartItem.quantity;
      subtotal += itemTotal;

      orderItemsData.push({
        productId: cartItem.productId,
        quantity: cartItem.quantity,
        price: cartItem.productPrice,
      });
    }

    // If any products have insufficient stock, throw error with details
    if (insufficientStockProducts.length > 0) {
      const errorMessage = insufficientStockProducts
        .map(p => `${p.name} (available: ${p.available}, requested: ${p.requested})`)
        .join(", ");
      throw new Error(`Insufficient stock for products: ${errorMessage}`);
    }

    // Validate and apply discount code if provided
    let discountAmount = 0;
    let discountCodeId: string | null = null;

    if (discountCode) {
      const discount = await validateDiscountCode(discountCode, customerId);
      if (!discount) {
        throw new Error("Invalid or unavailable discount code");
      }

      discountCodeId = discount.id;
      discountAmount = (subtotal * discount.discountPercentage) / 100;

      // Mark discount code as used within transaction
      await tx
        .update(discountCodes)
        .set({
          isUsed: true,
          isAvailable: false,
          updatedAt: new Date(),
        })
        .where(eq(discountCodes.id, discount.id));
    }

    const total = subtotal - discountAmount;

    // Create order within transaction
    const [order] = await tx
      .insert(orders)
      .values({
        customerId,
        discountCodeId,
        subtotal: subtotal.toString(),
        discountAmount: discountAmount.toString(),
        total: total.toString(),
        status: "completed",
      })
      .returning();

    // Create order items (inventory updates will be handled asynchronously)
    for (const item of orderItemsData) {
      // Insert order item
      await tx.insert(orderItems).values({
        orderId: order.id,
        productId: item.productId,
        quantity: item.quantity,
        price: item.price,
      });
    }

    // Clear cart within transaction
    await tx
      .delete(cartItems)
      .where(eq(cartItems.customerId, customerId));

    // Calculate per-customer order number for this order
    // Get all orders for this customer (including the one just created) sorted by creation date
    const customerOrders = await tx.query.orders.findMany({
      where: eq(orders.customerId, customerId),
      orderBy: (orders, { asc }) => [asc(orders.createdAt)],
    });
    // Find the index of the current order to get its order number (1-based)
    const orderIndex = customerOrders.findIndex((o) => o.id === order.id);
    const orderNumber = orderIndex >= 0 ? orderIndex + 1 : customerOrders.length;

    // Check if nth order condition is met and generate discount code for this customer
    // NOTE: This is done outside the main transaction since it's not critical for the order completion
    // and discount generation is handled separately

    // Return order data
    return {
      ...order,
      orderNumber, // Include per-customer order number in response
    };
  }).then(async (orderResult) => {
    // Handle post-checkout tasks asynchronously via job queue
    try {
      // Deactivate cart session since checkout is complete
      await cartSessionManager.deactivateSession(customerId);

      // Enqueue inventory update job
      const inventoryJobData: UpdateInventoryJobData = {
        orderId: orderResult.id,
        items: orderItemsData,
      };
      await jobProducer.enqueueInventoryUpdate(inventoryJobData);

      // Enqueue order confirmation email job
      const customer = await db.query.customers.findFirst({
        where: eq(customers.id, customerId),
      });

      if (customer?.email) {
        const emailJobData: SendOrderConfirmationJobData = {
          orderId: orderResult.id,
          customerId,
          customerEmail: customer.email,
          orderDetails: {
            total: orderResult.total,
            itemCount: orderItemsData.length,
            items: orderItemsData.map(item => ({
              name: `Product ${item.productId}`, // In real app, get from product data
              quantity: item.quantity,
              price: item.price,
            })),
          },
        };
        await jobProducer.enqueueOrderConfirmation(emailJobData);
      }

      // Enqueue discount code generation job (with delay)
      await jobProducer.enqueueDiscountCodeGeneration({
        customerId,
        reason: 'nth_order',
        orderId: orderResult.id,
      });

    } catch (error) {
      // Log but don't fail the checkout - jobs will be retried
      console.error("Failed to enqueue post-checkout jobs:", error);
    }

    return orderResult;
  });
}

/**
 * Get order by ID with optimized queries
 */
export async function getOrder(orderId: string) {
  // Single optimized query with window function for order number
  const orderWithNumber = await db.$with('order_with_number').as(
    db.select({
      id: orders.id,
      customerId: orders.customerId,
      discountCodeId: orders.discountCodeId,
      subtotal: orders.subtotal,
      discountAmount: orders.discountAmount,
      total: orders.total,
      status: orders.status,
      idempotencyKey: orders.idempotencyKey,
      paymentStatus: orders.paymentStatus,
      paymentGatewayId: orders.paymentGatewayId,
      paymentAttempts: orders.paymentAttempts,
      lastPaymentAttempt: orders.lastPaymentAttempt,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      // Calculate order number using window function
      orderNumber: sql<number>`ROW_NUMBER() OVER (
        PARTITION BY ${orders.customerId}
        ORDER BY ${orders.createdAt} ASC
      )`.as('order_number'),
    })
    .from(orders)
    .where(eq(orders.id, orderId))
  );

  // Get the complete order with all related data
  const [order] = await db
    .with(orderWithNumber)
    .select({
      id: orderWithNumber.id,
      customerId: orderWithNumber.customerId,
      discountCodeId: orderWithNumber.discountCodeId,
      subtotal: orderWithNumber.subtotal,
      discountAmount: orderWithNumber.discountAmount,
      total: orderWithNumber.total,
      status: orderWithNumber.status,
      idempotencyKey: orderWithNumber.idempotencyKey,
      paymentStatus: orderWithNumber.paymentStatus,
      paymentGatewayId: orderWithNumber.paymentGatewayId,
      paymentAttempts: orderWithNumber.paymentAttempts,
      lastPaymentAttempt: orderWithNumber.lastPaymentAttempt,
      createdAt: orderWithNumber.createdAt,
      updatedAt: orderWithNumber.updatedAt,
      orderNumber: orderWithNumber.orderNumber,
      // Include related data with joins
      customer: {
        id: customers.id,
        name: customers.name,
        email: customers.email,
      },
      discountCode: {
        id: discountCodes.id,
        code: discountCodes.code,
        discountPercentage: discountCodes.discountPercentage,
      },
      orderItems: db.select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        price: orderItems.price,
        createdAt: orderItems.createdAt,
        updatedAt: orderItems.updatedAt,
        product: {
          id: products.id,
          name: products.name,
          description: products.description,
          price: products.price,
          image: products.image,
          category: {
            id: categories.id,
            name: categories.name,
          },
        },
      })
      .from(orderItems)
      .leftJoin(products, eq(orderItems.productId, products.id))
      .leftJoin(categories, eq(products.categoryId, categories.id))
      .where(eq(orderItems.orderId, orderWithNumber.id)),
    })
    .from(orderWithNumber)
    .leftJoin(customers, eq(orderWithNumber.customerId, customers.id))
    .leftJoin(discountCodes, eq(orderWithNumber.discountCodeId, discountCodes.id));

  return order || null;
}

/**
 * Get all orders for a customer
 */
export async function getAllOrders(customerId: string) {
  // Optimized query: Get orders with window function for order numbers in a single query
  const ordersWithNumbers = await db.$with('orders_with_numbers').as(
    db.select({
      id: orders.id,
      customerId: orders.customerId,
      discountCodeId: orders.discountCodeId,
      subtotal: orders.subtotal,
      discountAmount: orders.discountAmount,
      total: orders.total,
      status: orders.status,
      idempotencyKey: orders.idempotencyKey,
      paymentStatus: orders.paymentStatus,
      paymentGatewayId: orders.paymentGatewayId,
      paymentAttempts: orders.paymentAttempts,
      lastPaymentAttempt: orders.lastPaymentAttempt,
      createdAt: orders.createdAt,
      updatedAt: orders.updatedAt,
      // Use window function to calculate order numbers efficiently
      orderNumber: sql<number>`ROW_NUMBER() OVER (ORDER BY ${orders.createdAt} ASC)`.as('order_number'),
    })
    .from(orders)
    .where(eq(orders.customerId, customerId))
    .orderBy(orders.createdAt)
  );

  // Get the orders with their related data using joins
  const ordersList = await db
    .with(ordersWithNumbers)
    .select({
      id: ordersWithNumbers.id,
      customerId: ordersWithNumbers.customerId,
      discountCodeId: ordersWithNumbers.discountCodeId,
      subtotal: ordersWithNumbers.subtotal,
      discountAmount: ordersWithNumbers.discountAmount,
      total: ordersWithNumbers.total,
      status: ordersWithNumbers.status,
      idempotencyKey: ordersWithNumbers.idempotencyKey,
      paymentStatus: ordersWithNumbers.paymentStatus,
      paymentGatewayId: ordersWithNumbers.paymentGatewayId,
      paymentAttempts: ordersWithNumbers.paymentAttempts,
      lastPaymentAttempt: ordersWithNumbers.lastPaymentAttempt,
      createdAt: ordersWithNumbers.createdAt,
      updatedAt: ordersWithNumbers.updatedAt,
      orderNumber: ordersWithNumbers.orderNumber,
      // Include related data
      customer: {
        id: customers.id,
        name: customers.name,
        email: customers.email,
      },
      discountCode: {
        id: discountCodes.id,
        code: discountCodes.code,
        discountPercentage: discountCodes.discountPercentage,
      },
      orderItems: db.select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        price: orderItems.price,
        createdAt: orderItems.createdAt,
        updatedAt: orderItems.updatedAt,
        product: {
          id: products.id,
          name: products.name,
          price: products.price,
          image: products.image,
        },
      })
      .from(orderItems)
      .leftJoin(products, eq(orderItems.productId, products.id))
      .where(eq(orderItems.orderId, ordersWithNumbers.id)),
    })
    .from(ordersWithNumbers)
    .leftJoin(customers, eq(ordersWithNumbers.customerId, customers.id))
    .leftJoin(discountCodes, eq(ordersWithNumbers.discountCodeId, discountCodes.id))
    .orderBy(sql`${ordersWithNumbers.createdAt} DESC`); // Newest first for display

  return ordersList;
}

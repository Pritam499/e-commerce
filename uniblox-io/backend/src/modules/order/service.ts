import { eq } from "drizzle-orm";
import { db } from "../../lib/db";
import { orders, orderItems, cartItems, products, customers } from "../../drizzle/schema";
import type { CheckoutInput } from "./schema";
import { validateDiscountCode, applyDiscountCode } from "../discount/service";
import { getCartItems, clearCart } from "../cart/service";
import { checkAndGenerateDiscountCode } from "../discount/service";

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
  
  // Ensure customer exists
  await ensureCustomerExists(customerId);

  // Get cart items
  const cartItemsList = await getCartItems(customerId);

  if (cartItemsList.length === 0) {
    throw new Error("Cart is empty");
  }

  // Calculate subtotal
  let subtotal = 0;
  const orderItemsData = [];

  for (const cartItem of cartItemsList) {
    const product = cartItem.product;
    const itemTotal = Number(product.price) * cartItem.quantity;
    subtotal += itemTotal;

    // Check stock availability
    if (product.stock < cartItem.quantity) {
      throw new Error(`Insufficient stock for product: ${product.name}`);
    }

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
    const discount = await validateDiscountCode(discountCode, customerId);
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
      customerId,
      discountCodeId,
      subtotal: subtotal.toString(),
      discountAmount: discountAmount.toString(),
      total: total.toString(),
      status: "completed",
    })
    .returning();

  // Create order items and update product stock
  for (const item of orderItemsData) {
    await db.insert(orderItems).values({
      orderId: order.id,
      productId: item.productId,
      quantity: item.quantity,
      price: item.price,
    });

    // Update product stock
    const product = await db.query.products.findFirst({
      where: eq(products.id, item.productId),
    });

    if (product) {
      await db
        .update(products)
        .set({
          stock: product.stock - item.quantity,
          updatedAt: new Date(),
        })
        .where(eq(products.id, item.productId));
    }
  }

  // Clear cart
  await clearCart(customerId);

  // Calculate per-customer order number for this order
  // Get all orders for this customer (including the one just created) sorted by creation date
  const customerOrders = await db.query.orders.findMany({
    where: eq(orders.customerId, customerId),
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
  await checkAndGenerateDiscountCode(customerId);

  return {
    ...order,
    orderNumber, // Include per-customer order number in response
  };
}

/**
 * Get order by ID
 */
export async function getOrder(orderId: string) {
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
export async function getAllOrders(customerId: string) {
  const ordersList = await db.query.orders.findMany({
    where: eq(orders.customerId, customerId),
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

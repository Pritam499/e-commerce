import { eq, and, count, sql, sum, inArray } from "drizzle-orm";
import { db } from "../../lib/db";
import { discountCodes, orders, orderItems, customers, users } from "../../drizzle/schema";
import { randomUUID } from "crypto";

const NTH_ORDER = parseInt(process.env.NTH_ORDER_DISCOUNT || "3");
const DISCOUNT_PERCENTAGE = 10;

/**
 * Get customer from userId
 */
async function getCustomerFromUserId(userId: string) {
  const customer = await db.query.customers.findFirst({
    where: eq(customers.userId, userId),
  });

  if (!customer) {
    // Get user details and create customer
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      throw new Error("User not found");
    }

    const [newCustomer] = await db.insert(customers).values({
      id: randomUUID(), // Use UUID for customers
      userId: userId,
      name: user.name,
      email: user.email,
    }).returning();

    return newCustomer;
  }

  return customer;
}

/**
 * Generate a unique discount code
 */
function generateDiscountCode(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Check if nth order condition is met and generate discount code for a specific customer
 *
 * IMPORTANT: This counts COMPLETED ORDERS (checkouts), not products in cart.
 * - A cart with 3 products becomes 1 order when checked out
 * - Discount is generated ONLY on every nth COMPLETED ORDER (3rd, 6th, 9th checkout)
 * - NOT on the 1st order or 3rd product added to cart
 * - This is per customer, not system-wide
 */
export async function checkAndGenerateDiscountCode(userId: string) {
  const customer = await getCustomerFromUserId(userId);

  // Get order count for this specific customer (counts completed orders/checkouts)
  const orderCountResult = await db
    .select({ count: count() })
    .from(orders)
    .where(eq(orders.customerId, customer.id));

  const customerOrderCount = orderCountResult[0].count;

  // IMPORTANT: Only generate if customer has placed >= nth order
  // NOT on 1st or 2nd order - wait until nth order is reached
  if (customerOrderCount < NTH_ORDER) {
    return; // Not enough orders yet - don't generate
  }

  // Step 1: Check if there's an UNUSED code for this customer
  // If unused code exists, don't generate - user must use previous coupon first
  const unusedCode = await db.query.discountCodes.findFirst({
    where: and(
      eq(discountCodes.isAvailable, true),
      eq(discountCodes.isUsed, false),
      eq(discountCodes.customerId, customer.id)
    ),
  });

  if (unusedCode) {
    return; // Unused coupon exists - don't generate new one
  }

  // Step 2: Check if enough orders have passed since last coupon generation
  // Get the most recent coupon (used or unused) to check when it was generated
  const allCustomerCoupons = await db.query.discountCodes.findMany({
    where: eq(discountCodes.customerId, customer.id),
    orderBy: (discountCodes, { desc }) => [desc(discountCodes.createdAt)],
  });

  if (allCustomerCoupons.length > 0) {
    const lastCoupon = allCustomerCoupons[0];
    const ordersSinceLastCoupon =
      customerOrderCount - (lastCoupon.orderNumberGenerated || 0);

    // Only generate if at least NTH_ORDER orders have been placed since last coupon was generated
    // This ensures we don't generate immediately after using a coupon
    if (ordersSinceLastCoupon < NTH_ORDER) {
      return; // Not enough orders since last coupon generation - don't generate
    }
  }

  // Step 3: Check purchase stats threshold (5 items, $300)
  // Only generate if purchase stats are met
  const purchaseStats = await getCustomerPurchaseStats(customer.id);
  const REQUIRED_ITEMS = 5;
  const REQUIRED_AMOUNT = 300;

  if (
    purchaseStats.totalItemsPurchased < REQUIRED_ITEMS ||
    purchaseStats.totalPurchaseAmount < REQUIRED_AMOUNT
  ) {
    // Purchase stats not met - don't generate
    return;
  }

  // Step 4: Verify previous coupon was used (if any exists)
  // If customer has coupons but none are used, don't generate (they should use existing one)
  if (allCustomerCoupons.length > 0) {
    const hasUsedCoupon = allCustomerCoupons.some((c) => c.isUsed);
    if (!hasUsedCoupon) {
      // Has coupons but none used - shouldn't happen if logic is correct, but safety check
      return;
    }
  }

  // All conditions met - generate new discount code
  let code: string;
  let isUnique = false;

  // Ensure code is unique
  while (!isUnique) {
    code = generateDiscountCode();
    const existing = await db.query.discountCodes.findFirst({
      where: eq(discountCodes.code, code),
    });
    if (!existing) {
      isUnique = true;
    }
  }

  await db.insert(discountCodes).values({
    code: code!,
    discountPercentage: DISCOUNT_PERCENTAGE,
    isAvailable: true,
    isUsed: false,
    customerId: customer.id,
    orderNumberGenerated: customerOrderCount,
  });
}

/**
 * Validate discount code for a specific customer
 */
export async function validateDiscountCode(code: string, userId: string) {
  const customer = await getCustomerFromUserId(userId);
  const discount = await db.query.discountCodes.findFirst({
    where: eq(discountCodes.code, code),
  });

  if (!discount) {
    return null;
  }

  // Check if discount belongs to this customer
  if (discount.customerId !== customer.id) {
    return null;
  }

  if (discount.isUsed) {
    return null;
  }

  if (!discount.isAvailable) {
    return null;
  }

  return discount;
}

/**
 * Preview discount (calculate discount amount without applying)
 */
export async function previewDiscount(
  code: string,
  userId: string,
  subtotal: number
) {
  const discount = await validateDiscountCode(code, userId);

  if (!discount) {
    return {
      valid: false,
      discountAmount: 0,
      total: subtotal,
      message: "Invalid or unavailable discount code",
    };
  }

  const discountAmount = (subtotal * discount.discountPercentage) / 100;
  const total = subtotal - discountAmount;

  return {
    valid: true,
    discountCode: discount.code,
    discountPercentage: discount.discountPercentage,
    discountAmount,
    total,
    subtotal,
  };
}

/**
 * Apply discount code (mark as used)
 */
export async function applyDiscountCode(discountCodeId: string) {
  await db
    .update(discountCodes)
    .set({
      isUsed: true,
      isAvailable: false,
      updatedAt: new Date(),
    })
    .where(eq(discountCodes.id, discountCodeId));
}

/**
 * Generate discount code for a specific customer (if conditions are met)
 *
 * 4-Step Condition Checking:
 * 1. Check if customer has unused coupon → return it
 * 2. Check if customer completed nth order → if no, throw error
 * 3. Check if customer reached purchase stats (5 items, $300) → if no, throw error
 * 4. Check if previous coupon was used → if no, throw error; if yes, generate
 */
export async function generateDiscountCodeForCustomer(userId: string) {
  const customer = await getCustomerFromUserId(userId);
  // Step 1: Check if customer has unused coupon
  const availableCode = await db.query.discountCodes.findFirst({
    where: and(
      eq(discountCodes.isAvailable, true),
      eq(discountCodes.isUsed, false),
      eq(discountCodes.customerId, customer.id)
    ),
  });

  if (availableCode) {
    // Return existing unused coupon (available for next order)
    return availableCode;
  }

  // Step 2: Check if customer completed nth order
  const orderCountResult = await db
    .select({ count: count() })
    .from(orders)
    .where(eq(orders.customerId, customer.id));

  const customerOrderCount = orderCountResult[0].count;

  if (customerOrderCount < NTH_ORDER) {
    // Not nth order yet - need to place at least NTH_ORDER orders
    const ordersNeeded = NTH_ORDER - customerOrderCount;
    const orderSuffix =
      NTH_ORDER === 1
        ? "st"
        : NTH_ORDER === 2
        ? "nd"
        : NTH_ORDER === 3
        ? "rd"
        : "th";

    const message =
      customerOrderCount === 0
        ? `Complete ${NTH_ORDER} orders first. Discount code will be generated automatically after your ${NTH_ORDER}${orderSuffix} order is placed.`
        : `You have placed ${customerOrderCount} order(s). Complete ${ordersNeeded} more order(s) to reach your ${NTH_ORDER}${orderSuffix} order. Discount code will be generated automatically after your ${NTH_ORDER}${orderSuffix} order is placed.`;

    throw new Error(message);
  }

  // Step 3: Check if customer reached purchase stats threshold (5 items, $300)
  const purchaseStats = await getCustomerPurchaseStats(customer.id);
  const REQUIRED_ITEMS = 5;
  const REQUIRED_AMOUNT = 300;

  if (
    purchaseStats.totalItemsPurchased < REQUIRED_ITEMS ||
    purchaseStats.totalPurchaseAmount < REQUIRED_AMOUNT
  ) {
    // Purchase stats not met
    const itemsNeeded = Math.max(
      0,
      REQUIRED_ITEMS - purchaseStats.totalItemsPurchased
    );
    const amountNeeded = Math.max(
      0,
      REQUIRED_AMOUNT - purchaseStats.totalPurchaseAmount
    );

    throw new Error(
      `Reach purchase threshold first. You need ${itemsNeeded} more item(s) and $${amountNeeded.toFixed(
        2
      )} more to qualify. ` +
        `Current: ${
          purchaseStats.totalItemsPurchased
        } items, $${purchaseStats.totalPurchaseAmount.toFixed(2)}. ` +
        `Required: ${REQUIRED_ITEMS} items, $${REQUIRED_AMOUNT}.`
    );
  }

  // Step 4: Check if previous coupon was used
  // Get all coupons for this customer (including used ones)
  const allCustomerCoupons = await db.query.discountCodes.findMany({
    where: eq(discountCodes.customerId, customer.id),
    orderBy: (discountCodes, { desc }) => [desc(discountCodes.createdAt)],
  });

  // Check if there's any unused coupon (should have been caught in step 1, but verify)
  const unusedCoupon = allCustomerCoupons.find(
    (c) => !c.isUsed && c.isAvailable
  );
  if (unusedCoupon) {
    throw new Error(
      `You have an unused coupon (${unusedCoupon.code}). Use it on your next order before generating a new one.`
    );
  }

  // All conditions met - generate new coupon
  let code: string;
  let isUnique = false;

  while (!isUnique) {
    code = generateDiscountCode();
    const existing = await db.query.discountCodes.findFirst({
      where: eq(discountCodes.code, code),
    });
    if (!existing) {
      isUnique = true;
    }
  }

  const [newCode] = await db
    .insert(discountCodes)
    .values({
      code: code!,
      discountPercentage: DISCOUNT_PERCENTAGE,
      isAvailable: true,
      isUsed: false,
      customerId: customer.id,
      orderNumberGenerated: customerOrderCount,
    })
    .returning();

  return newCode;
}

/**
 * Get all discount codes
 */
export async function getAllDiscountCodes() {
  const codes = await db.query.discountCodes.findMany({
    orderBy: (discountCodes, { desc }) => [desc(discountCodes.createdAt)],
  });

  return codes;
}

/**
 * Get available discount codes for a specific customer (not used, isAvailable = true)
 */
export async function getAvailableDiscountCodes(userId: string) {
  const customer = await getCustomerFromUserId(userId);
  const codes = await db.query.discountCodes.findMany({
    where: and(
      eq(discountCodes.isAvailable, true),
      eq(discountCodes.isUsed, false),
      eq(discountCodes.customerId, customer.id)
    ),
    orderBy: (discountCodes, { desc }) => [desc(discountCodes.createdAt)],
  });

  return codes;
}

/**
 * Get customer's purchase statistics
 * Calculates total items purchased and total purchase amount for a customer
 */
export async function getCustomerPurchaseStats(customerUUID: string) {
  // Get customer's order IDs
  const customerOrders = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.customerId, customerUUID));

  const orderIds = customerOrders.map((o) => o.id);

  // Calculate total items purchased (sum of all order_items.quantity for this customer)
  let totalItemsPurchased = 0;
  if (orderIds.length > 0) {
    const itemsResult = await db
      .select({ totalItems: sum(orderItems.quantity) })
      .from(orderItems)
      .where(inArray(orderItems.orderId, orderIds));

    totalItemsPurchased = Number(itemsResult[0]?.totalItems || 0);
  }

  // Calculate total purchase amount (sum of all orders.total for this customer)
  const totalAmountResult = await db
    .select({ totalAmount: sum(orders.total) })
    .from(orders)
    .where(eq(orders.customerId, customerUUID));

  const totalPurchaseAmount = Number(totalAmountResult[0]?.totalAmount || 0);

  return {
    totalItemsPurchased,
    totalPurchaseAmount,
  };
}

/**
 * Check if customer is eligible to generate discount on their next order (nth order)
 * Returns true if their next order (current count + 1) will be the nth order
 */
export async function isEligibleForNthOrderDiscount(userId: string) {
  const customer = await getCustomerFromUserId(userId);
  const orderCountResult = await db
    .select({ count: count() })
    .from(orders)
    .where(eq(orders.customerId, customer.id));

  const customerOrderCount = orderCountResult[0].count;
  const nextOrderNumber = customerOrderCount + 1;

  // Check if next order will be >= nth order (eligible after nth order is reached)
  return nextOrderNumber >= NTH_ORDER;
}

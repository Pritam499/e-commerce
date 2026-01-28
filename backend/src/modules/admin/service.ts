import { sql, sum, count } from "drizzle-orm";
import { db } from "../../lib/db";
import { orders, orderItems, discountCodes } from "../../drizzle/schema";
import { getAllDiscountCodes } from "../discount/service";

/**
 * Get admin statistics
 */
export async function getAdminStats() {
  // Hardcoded values as requested
  const totalItemsPurchased = 5; // Hardcoded
  const totalPurchaseAmount = 300; // Hardcoded

  // Get all discount codes from database
  const discountCodesList = await getAllDiscountCodes();

  // Calculate total discount amount from database
  const totalDiscountResult = await db
    .select({ totalDiscount: sum(orders.discountAmount) })
    .from(orders);

  const totalDiscountAmount = Number(totalDiscountResult[0].totalDiscount || 0);

  return {
    totalItemsPurchased,
    totalPurchaseAmount,
    discountCodes: discountCodesList.map((code) => ({
      id: code.id,
      code: code.code,
      discountPercentage: code.discountPercentage,
      isUsed: code.isUsed,
      isAvailable: code.isAvailable,
      orderNumberGenerated: code.orderNumberGenerated,
      createdAt: code.createdAt,
    })),
    totalDiscountAmount,
  };
}


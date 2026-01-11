import { db } from "../lib/db";
import { orders, discountCodes, orderItems } from "../drizzle/schema";
import { eq, sum, count, inArray } from "drizzle-orm";
import { generateDiscountCodeForCustomer, getCustomerPurchaseStats } from "../modules/discount/service";

const customerId = process.argv[2];

if (!customerId) {
  console.error("Usage: tsx src/scripts/check-and-generate-coupon.ts <customerId>");
  process.exit(1);
}

async function main() {
  console.log(`\n🔍 Checking customer: ${customerId}\n`);

  // Check order count
  const orderCountResult = await db
    .select({ count: count() })
    .from(orders)
    .where(eq(orders.customerId, customerId));
  
  const orderCount = orderCountResult[0].count;
  console.log(`📦 Total Orders: ${orderCount}`);

  // Check purchase stats
  const stats = await getCustomerPurchaseStats(customerId);
  console.log(`📊 Purchase Stats:`);
  console.log(`   - Total Items: ${stats.totalItemsPurchased}`);
  console.log(`   - Total Amount: $${stats.totalPurchaseAmount.toFixed(2)}`);
  console.log(`   - Required: 5 items, $300`);

  // Check existing coupons
  const existingCoupons = await db.query.discountCodes.findMany({
    where: eq(discountCodes.customerId, customerId),
    orderBy: (discountCodes, { desc }) => [desc(discountCodes.createdAt)],
  });

  console.log(`\n🎫 Existing Coupons: ${existingCoupons.length}`);
  existingCoupons.forEach((coupon, idx) => {
    console.log(`   ${idx + 1}. ${coupon.code} - Used: ${coupon.isUsed}, Available: ${coupon.isAvailable}`);
  });

  // Check nth order condition
  const NTH_ORDER = 3;
  const isNthOrder = orderCount >= NTH_ORDER;
  console.log(`\n✅ Nth Order Check (>= ${NTH_ORDER}rd): ${isNthOrder ? 'PASS' : 'FAIL'}`);

  // Check purchase stats
  const meetsStats = stats.totalItemsPurchased >= 5 && stats.totalPurchaseAmount >= 300;
  console.log(`✅ Purchase Stats Check: ${meetsStats ? 'PASS' : 'FAIL'}`);

  // Check unused coupon
  const unusedCoupon = existingCoupons.find(c => !c.isUsed && c.isAvailable);
  console.log(`✅ Unused Coupon Check: ${unusedCoupon ? 'EXISTS (must use first)' : 'NONE'}`);

  // Try to generate
  console.log(`\n🎁 Attempting to generate coupon...\n`);
  try {
    const result = await generateDiscountCodeForCustomer(customerId);
    console.log(`✅ SUCCESS! Generated coupon:`);
    console.log(`   Code: ${result.code}`);
    console.log(`   Discount: ${result.discountPercentage}%`);
    console.log(`   Order Number: ${result.orderNumberGenerated}`);
  } catch (error: any) {
    console.error(`❌ FAILED: ${error.message}`);
    
    // If failed due to nth order but stats are met, force generate
    if (meetsStats && !unusedCoupon && error.message.includes('order')) {
      console.log(`\n🔄 Force generating coupon (stats met, bypassing nth order check)...\n`);
      try {
        const DISCOUNT_PERCENTAGE = 10;
        
        // Generate unique code
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        let code = "";
        let isUnique = false;
        
        while (!isUnique) {
          code = "";
          for (let i = 0; i < 8; i++) {
            code += chars.charAt(Math.floor(Math.random() * chars.length));
          }
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
            code: code,
            discountPercentage: DISCOUNT_PERCENTAGE,
            isAvailable: true,
            isUsed: false,
            customerId: customerId,
            orderNumberGenerated: orderCount,
          })
          .returning();
        
        console.log(`✅ FORCE GENERATED COUPON:`);
        console.log(`   Code: ${newCode.code}`);
        console.log(`   Discount: ${newCode.discountPercentage}%`);
        console.log(`   Order Number: ${newCode.orderNumberGenerated}`);
      } catch (forceError: any) {
        console.error(`❌ Force generation also failed: ${forceError.message}`);
      }
    }
  }

  process.exit(0);
}

main().catch(console.error);

import { db } from "../lib/db";
import { orders, customers, discountCodes } from "../drizzle/schema";
import { eq, count } from "drizzle-orm";
import { getCustomerPurchaseStats } from "../modules/discount/service";

async function main() {
  console.log(`\n📋 Listing all customers and their stats...\n`);

  const allCustomers = await db.query.customers.findMany({
    orderBy: (customers, { desc }) => [desc(customers.createdAt)],
  });

  if (allCustomers.length === 0) {
    console.log("No customers found.");
    process.exit(0);
  }

  for (const customer of allCustomers) {
    const orderCountResult = await db
      .select({ count: count() })
      .from(orders)
      .where(eq(orders.customerId, customer.id));

    const orderCount = orderCountResult[0].count;
    const stats = await getCustomerPurchaseStats(customer.id);

    const coupons = await db.query.discountCodes.findMany({
      where: eq(discountCodes.customerId, customer.id),
    });

    const unusedCoupons = coupons.filter((c) => !c.isUsed && c.isAvailable);

    console.log(`Customer ID: ${customer.id}`);
    console.log(`  Orders: ${orderCount}`);
    console.log(
      `  Items: ${
        stats.totalItemsPurchased
      }, Amount: $${stats.totalPurchaseAmount.toFixed(2)}`
    );
    console.log(
      `  Coupons: ${coupons.length} total, ${unusedCoupons.length} unused`
    );
    if (unusedCoupons.length > 0) {
      console.log(`  Unused: ${unusedCoupons.map((c) => c.code).join(", ")}`);
    }
    console.log("");
  }

  process.exit(0);
}

main().catch(console.error);

import * as dotenv from "dotenv";
import { checkout } from "../modules/order/service";
import { addToCart } from "../modules/cart/service";
import { db } from "../lib/db";
import { products, categories } from "../drizzle/schema";
import { eq } from "drizzle-orm";

dotenv.config();

/**
 * Demo script to show race condition prevention
 * This demonstrates how the transaction-based approach prevents overselling
 */
async function demoRaceConditions() {
  console.log("🎯 Race Condition Prevention Demo");
  console.log("==================================\n");

  const testProductId = "demo-flash-sale-product";
  const initialStock = 5; // Small number for easy demo
  const concurrentUsers = 8; // More than available stock

  try {
    // Setup
    console.log(`📦 Setting up product with ${initialStock} stock`);
    const electronicsCategory = await db.query.categories.findFirst({
      where: eq(categories.name, "Electronics"),
    });

    if (!electronicsCategory) {
      console.log("❌ Electronics category not found. Run seed first.");
      return;
    }

    await db
      .insert(products)
      .values({
        id: testProductId,
        categoryId: electronicsCategory.id,
        name: "Demo Flash Sale Item",
        description: "Limited stock demo product",
        price: "99.99",
        stock: initialStock,
        image: "https://via.placeholder.com/150x150?text=Demo",
        rating: "4.5",
      })
      .onConflictDoUpdate({
        target: products.id,
        set: { stock: initialStock },
      });

    console.log("✅ Demo product ready\n");

    // Test 1: Sequential checkouts (should work fine)
    console.log("🧪 Test 1: Sequential checkouts");
    for (let i = 1; i <= initialStock; i++) {
      const customerId = `demo-customer-${i}`;
      await addToCart(customerId, testProductId, 1);
      await checkout({ customerId });
      console.log(`  ✅ Customer ${i} checkout successful`);
    }

    // Check stock
    let product = await db.query.products.findFirst({
      where: eq(products.id, testProductId),
    });
    console.log(`📦 Stock after sequential: ${product?.stock} (should be 0)\n`);

    // Test 2: Reset and try concurrent (this will show the protection)
    console.log("🧪 Test 2: Concurrent checkout protection");
    await db.update(products).set({ stock: initialStock }).where(eq(products.id, testProductId));

    const customerIds = Array.from(
      { length: concurrentUsers },
      (_, i) => `concurrent-customer-${i + 1}-${Date.now()}`
    );

    // Add to carts
    await Promise.all(customerIds.map(id => addToCart(id, testProductId, 1)));
    console.log(`🛒 Added items to ${concurrentUsers} carts`);

    // Concurrent checkouts
    const results = await Promise.allSettled(
      customerIds.map(async (id, index) => {
        const result = await checkout({ customerId: id });
        return { customer: index + 1, success: true, orderId: result.id };
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`✅ Successful checkouts: ${successful}`);
    console.log(`❌ Failed checkouts: ${failed}`);

    // Final stock check
    product = await db.query.products.findFirst({
      where: eq(products.id, testProductId),
    });
    console.log(`📦 Final stock: ${product?.stock} (should be 0)`);

    if (successful === initialStock && product?.stock === 0) {
      console.log("\n🎉 SUCCESS: Race conditions prevented!");
      console.log("   - No overselling occurred");
      console.log("   - Stock integrity maintained");
    } else {
      console.log("\n❌ ISSUE: Race condition detected!");
    }

    // Cleanup
    await db.delete(products).where(eq(products.id, testProductId));
    console.log("\n🧹 Demo cleanup completed");

  } catch (error) {
    console.error("💥 Demo failed:", error);
  }
}

// Run demo
demoRaceConditions().then(() => {
  console.log("\n🎯 Demo completed successfully!");
}).catch(console.error);
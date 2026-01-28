import * as dotenv from "dotenv";
import { checkout } from "../modules/order/service";
import { addToCart } from "../modules/cart/service";
import { db } from "../lib/db";
import { products, categories } from "../drizzle/schema";
import { eq } from "drizzle-orm";

dotenv.config();

/**
 * Test script to simulate race conditions during checkout
 * Simulates a flash sale scenario where multiple users try to buy limited stock
 */
async function testRaceConditions() {
  console.log("🧪 Testing Race Conditions in Checkout Process");
  console.log("================================================\n");

  // Setup test data
  const testProductId = "test-flash-sale-product";
  const initialStock = 20; // Only 20 items available
  const numberOfConcurrentUsers = 33; // More users than available stock

  console.log(`📦 Setting up test product with ${initialStock} stock`);
  console.log(`👥 Simulating ${numberOfConcurrentUsers} concurrent users\n`);

  try {
    // Find electronics category
    const electronicsCategory = await db.query.categories.findFirst({
      where: eq(categories.name, "Electronics"),
    });

    if (!electronicsCategory) {
      throw new Error("Electronics category not found. Please run seed first.");
    }

    // Create or update test product with limited stock
    await db
      .insert(products)
      .values({
        id: testProductId,
        categoryId: electronicsCategory.id,
        name: "Flash Sale Smartphone",
        description: "Limited stock flash sale item",
        price: "299.99",
        stock: initialStock,
        image: "https://via.placeholder.com/300x300?text=Flash+Sale",
        rating: "4.8",
      })
      .onConflictDoUpdate({
        target: products.id,
        set: {
          stock: initialStock,
          name: "Flash Sale Smartphone",
          description: "Limited stock flash sale item",
          price: "299.99",
          updatedAt: new Date(),
        },
      });

    console.log("✅ Test product created/updated\n");

    // Generate unique customer IDs
    const customerIds = Array.from(
      { length: numberOfConcurrentUsers },
      (_, i) => `test-customer-${i + 1}-${Date.now()}`
    );

    // Add items to each customer's cart
    console.log("🛒 Adding items to carts...");
    const cartPromises = customerIds.map(async (customerId) => {
      await addToCart(customerId, testProductId, 1); // Each wants 1 item
    });
    await Promise.all(cartPromises);
    console.log("✅ All carts populated\n");

    // Simulate concurrent checkouts
    console.log("💥 Simulating concurrent checkouts...");
    console.log("Expected: Only 20 should succeed, 13 should fail\n");

    const checkoutPromises = customerIds.map(async (customerId, index) => {
      try {
        const result = await checkout({
          customerId,
          discountCode: undefined,
        });
        return { success: true, customerId, orderId: result.id };
      } catch (error: any) {
        return { success: false, customerId, error: error.message };
      }
    });

    // Wait for all checkouts to complete
    const results = await Promise.all(checkoutPromises);

    // Analyze results
    const successfulOrders = results.filter(r => r.success);
    const failedOrders = results.filter(r => !r.success);

    console.log("📊 RESULTS:");
    console.log(`✅ Successful orders: ${successfulOrders.length}`);
    console.log(`❌ Failed orders: ${failedOrders.length}\n`);

    if (successfulOrders.length !== initialStock) {
      console.log("🚨 ERROR: Number of successful orders doesn't match available stock!");
      console.log(`Expected: ${initialStock}, Got: ${successfulOrders.length}`);
    } else {
      console.log("✅ SUCCESS: Exactly the right number of orders succeeded!");
    }

    // Check final stock
    const finalProduct = await db.query.products.findFirst({
      where: eq(products.id, testProductId),
    });

    console.log(`📦 Final stock: ${finalProduct?.stock} (should be 0)`);

    if (finalProduct?.stock !== 0) {
      console.log("🚨 ERROR: Stock not properly reduced!");
    } else {
      console.log("✅ SUCCESS: Stock properly reduced to 0!");
    }

    // Show some failed order errors
    if (failedOrders.length > 0) {
      console.log("\n❌ Sample failure reasons:");
      failedOrders.slice(0, 3).forEach(failure => {
        console.log(`- Customer ${failure.customerId.split('-')[2]}: ${failure.error}`);
      });
    }

    // Cleanup test data
    console.log("\n🧹 Cleaning up test data...");
    await db.delete(products).where(eq(products.id, testProductId));
    console.log("✅ Test data cleaned up");

  } catch (error) {
    console.error("💥 Test failed:", error);
    process.exit(1);
  }
}

// Run the test
testRaceConditions().then(() => {
  console.log("\n🎉 Race condition test completed!");
  process.exit(0);
}).catch((error) => {
  console.error("💥 Test failed with error:", error);
  process.exit(1);
});
import * as dotenv from "dotenv";
import { db } from "./lib/db";
import { categories, products, customers } from "./drizzle/schema";

dotenv.config();

// Fetch products from FakeStoreAPI
async function fetchFakeStoreProducts() {
  try {
    const response = await fetch("https://fakestoreapi.com/products");
    if (!response.ok) {
      throw new Error("Failed to fetch products from FakeStoreAPI");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching from FakeStoreAPI:", error);
    return [];
  }
}

async function seed() {
  try {
    console.log("Starting seed...");

    // Note: We no longer create a default customer since customers use UUIDs
    // Customers will be created automatically when they first add items to cart
    console.log("Skipping default customer creation (using UUID-based customers)");

    // Fetch products from FakeStoreAPI
    const fakeStoreProducts = await fetchFakeStoreProducts();
    
    if (fakeStoreProducts.length === 0) {
      console.log("No products fetched from FakeStoreAPI, using fallback data");
      // Fallback to basic seed if API fails
      await seedFallback();
      return;
    }

    // Get unique categories from FakeStoreAPI products
    const uniqueCategories = Array.from(
      new Set(fakeStoreProducts.map((p: any) => p.category))
    );

    // Create categories
    const categoryMap = new Map<string, string>();
    for (const catName of uniqueCategories) {
      // Check if category already exists
      const existing = await db.query.categories.findMany({
        where: (categories, { eq }) => eq(categories.name, catName),
      });

      if (existing.length > 0) {
        categoryMap.set(catName, existing[0].id);
      } else {
        // Create new category
        const [category] = await db
          .insert(categories)
          .values({
            name: catName,
            description: `Products in ${catName} category`,
          })
          .returning();
        if (category) {
          categoryMap.set(catName, category.id);
        }
      }
    }

    console.log(`Created/found ${categoryMap.size} categories`);

    // Insert products
    let insertedCount = 0;
    for (const product of fakeStoreProducts) {
      const categoryId = categoryMap.get(product.category);
      if (!categoryId) continue;

      try {
        // Check if product already exists
        const existing = await db.query.products.findMany({
          where: (products, { eq }) => eq(products.name, product.title),
        });

        if (existing.length === 0) {
          await db.insert(products).values({
            categoryId,
            name: product.title,
            description: product.description,
            price: product.price.toString(),
            stock: Math.floor(Math.random() * 100) + 10, // Random stock between 10-110
            image: product.image,
            rating: (Math.random() * 4 + 1).toFixed(1), // Random rating between 1.0-5.0
          });
          insertedCount++;
        }
      } catch (error: any) {
        // Skip duplicates
        console.log(`Skipping duplicate product: ${product.title} - ${error.message}`);
      }
    }

    console.log(`\nSeed completed successfully!`);
    console.log(`Total categories: ${categoryMap.size}`);
    console.log(`Total products inserted: ${insertedCount}`);
  } catch (error) {
    console.error("Error seeding database:", error);
    process.exit(1);
  }
}

async function seedFallback() {
  // Fallback seed data if API fails
  const categoryData = [
    { name: "Electronics", description: "Electronic devices and gadgets" },
    { name: "Clothing", description: "Fashion and apparel" },
    { name: "Home & Kitchen", description: "Home improvement and kitchen essentials" },
    { name: "Books", description: "Books and literature" },
    { name: "Sports & Outdoors", description: "Sports equipment and outdoor gear" },
  ];

  const insertedCategories = await db
    .insert(categories)
    .values(categoryData)
    .returning();

  console.log(`Inserted ${insertedCategories.length} categories (fallback)`);

  // Insert some sample products
  const sampleProducts = [
    { name: "Wireless Headphones", category: "Electronics", price: "99.99", description: "High-quality wireless headphones", stock: 50, rating: "4.5" },
    { name: "Smartphone Case", category: "Electronics", price: "19.99", description: "Protective case for smartphones", stock: 100, rating: "4.2" },
    { name: "T-Shirt", category: "Clothing", price: "29.99", description: "Comfortable cotton t-shirt", stock: 75, rating: "4.0" },
    { name: "Coffee Maker", category: "Home & Kitchen", price: "79.99", description: "Automatic drip coffee maker", stock: 30, rating: "4.3" },
    { name: "Programming Book", category: "Books", price: "49.99", description: "Learn programming fundamentals", stock: 20, rating: "4.7" },
  ];

  for (const prod of sampleProducts) {
    const category = insertedCategories.find(c => c.name === prod.category);
    if (category) {
      await db.insert(products).values({
        categoryId: category.id,
        name: prod.name,
        description: prod.description,
        price: prod.price,
        stock: prod.stock,
        rating: prod.rating,
      });
    }
  }

  console.log(`Inserted ${sampleProducts.length} sample products (fallback)`);
}

seed();

import { db } from "../../lib/db";
import { products, productViews, categories } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

export interface RecommendationResult {
  id: string;
  name: string;
  price: string;
  rating: string;
  image?: string;
  category: {
    name: string;
  };
}

/**
 * Get personalized recommendations for a product
 * Based on category, price similarity, rating, and user history
 */
export async function getRecommendations(
  customerId: string,
  productId: string,
  limit: number = 5
): Promise<RecommendationResult[]> {
  // First, get the current product details
  const currentProduct = await db.query.products.findFirst({
    where: eq(products.id, productId),
    with: {
      category: true,
    },
  });

  if (!currentProduct) {
    return [];
  }

  // Track this product view
  await trackProductView(customerId, productId);

  const recommendations = new Map<string, RecommendationResult>();
  const excludedIds = new Set([productId]);

  // 1. Same category, high rated products (40% weight)
  const categoryProducts = await db.query.products.findMany({
    where: and(
      eq(products.categoryId, currentProduct.categoryId),
      sql`${products.id} != ${productId}`
    ),
    with: {
      category: true,
    },
    orderBy: [desc(products.rating), desc(products.price)],
    limit: Math.ceil(limit * 0.4),
  });

  categoryProducts.forEach(product => {
    if (!excludedIds.has(product.id)) {
      recommendations.set(product.id, {
        id: product.id,
        name: product.name,
        price: product.price,
        rating: product.rating,
        image: product.image || undefined,
        category: { name: product.category?.name || "Uncategorized" },
      });
      excludedIds.add(product.id);
    }
  });

  // 2. Similar price range (±20%) (30% weight)
  const priceLower = parseFloat(currentProduct.price) * 0.8;
  const priceUpper = parseFloat(currentProduct.price) * 1.2;

  const priceSimilarProducts = await db.query.products.findMany({
    where: and(
      sql`${products.price} >= ${priceLower} AND ${products.price} <= ${priceUpper}`,
      sql`${products.id} != ${productId}`
    ),
    with: {
      category: true,
    },
    orderBy: [desc(products.rating)],
    limit: Math.ceil(limit * 0.3),
  });

  priceSimilarProducts.forEach(product => {
    if (!excludedIds.has(product.id)) {
      recommendations.set(product.id, {
        id: product.id,
        name: product.name,
        price: product.price,
        rating: product.rating,
        image: product.image || undefined,
        category: { name: product.category?.name || "Uncategorized" },
      });
      excludedIds.add(product.id);
    }
  });

  // 3. Recently viewed products from same category (20% weight)
  const recentViews = await db.query.productViews.findMany({
    where: eq(productViews.customerId, customerId),
    orderBy: desc(productViews.viewedAt),
    limit: 10,
    with: {
      product: {
        with: {
          category: true,
        },
      },
    },
  });

  const recentCategoryProducts = recentViews
    .filter(view => view.product.categoryId === currentProduct.categoryId && !excludedIds.has(view.productId))
    .slice(0, Math.ceil(limit * 0.2));

  recentCategoryProducts.forEach(view => {
    const product = view.product;
    if (!excludedIds.has(product.id)) {
      recommendations.set(product.id, {
        id: product.id,
        name: product.name,
        price: product.price,
        rating: product.rating,
        image: product.image || undefined,
        category: { name: product.category?.name || "Uncategorized" },
      });
      excludedIds.add(product.id);
    }
  });

  // 4. Popular products in other categories (10% weight) - fallback
  if (recommendations.size < limit) {
    const popularProducts = await db.query.products.findMany({
      where: sql`${products.id} != ${productId}`,
      with: {
        category: true,
      },
      orderBy: [desc(products.rating), desc(products.price)],
      limit: limit - recommendations.size,
    });

    popularProducts.forEach(product => {
      if (!excludedIds.has(product.id)) {
        recommendations.set(product.id, {
          id: product.id,
          name: product.name,
          price: product.price,
          rating: product.rating,
          image: product.image || undefined,
          category: { name: product.category?.name || "Uncategorized" },
        });
      }
    });
  }

  // Return top recommendations
  return Array.from(recommendations.values()).slice(0, limit);
}

/**
 * Track a product view for recommendation personalization
 */
export async function trackProductView(customerId: string, productId: string, sessionId?: string) {
  try {
    await db.insert(productViews).values({
      customerId,
      productId,
      sessionId,
    });
  } catch (error) {
    // Silently fail if tracking fails (don't break user experience)
    console.error("Failed to track product view:", error);
  }
}
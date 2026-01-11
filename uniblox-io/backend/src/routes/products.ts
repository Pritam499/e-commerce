import { FastifyInstance } from "fastify";
import { db } from "../lib/db";
import { products } from "../drizzle/schema";
import { eq, count } from "drizzle-orm";

export async function productRoutes(fastify: FastifyInstance) {
  // Get all products with pagination
  fastify.get("/api/products", async (request: any, reply) => {
    try {
      const page = parseInt(request.query.page || "1");
      const limit = parseInt(request.query.limit || "10");
      const offset = (page - 1) * limit;

      const allProducts = await db.query.products.findMany({
        with: {
          category: true,
        },
        limit,
        offset,
      });

      // Get total count for pagination
      const totalCountResult = await db
        .select({ count: count() })
        .from(products);
      const total = totalCountResult[0].count;
      const totalPages = Math.ceil(total / limit);

      return reply.code(200).send({
        success: true,
        data: allProducts,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get products",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  // Get product by ID
  fastify.get("/api/products/:id", async (request: any, reply) => {
    try {
      const productId = request.params.id;
      if (!productId || typeof productId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Invalid product ID",
        });
      }

      const product = await db.query.products.findFirst({
        where: eq(products.id, productId),
        with: {
          category: true,
        },
      });

      if (!product) {
        return reply.code(404).send({
          success: false,
          error: "Product not found",
        });
      }

      return reply.code(200).send({
        success: true,
        data: product,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get product",
      });
    }
  });
}

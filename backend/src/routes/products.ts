import { FastifyInstance } from "fastify";
import { db } from "../lib/db";
import { products } from "../drizzle/schema";
import { eq, count } from "drizzle-orm";
import { productsQuerySchema, productIdParamsSchema, type ProductsQuery, type ProductIdParams } from "../modules/products/schema";
import { validateQuery, validateParams } from "../lib/validation";
import { singleImageUpload, multipleImageUpload } from "../lib/upload-middleware";
import { logger } from "../lib/logger";

export async function productRoutes(fastify: FastifyInstance) {
  // Get all products with pagination
  fastify.get<{ Querystring: ProductsQuery }>("/api/products", {
    preHandler: [validateQuery(productsQuerySchema)],
  }, async (request: any, reply: any) => {
    try {
      const { page, limit } = request.query;
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
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get products",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  // Get product by ID
  fastify.get<{ Params: ProductIdParams }>("/api/products/:id", {
    preHandler: [validateParams(productIdParamsSchema)],
  }, async (request: any, reply: any) => {
    try {
      const { id: productId } = request.params;

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

  // Upload product images
  fastify.post<{ Params: ProductIdParams }>("/api/products/:id/images", {
    preHandler: [validateParams(productIdParamsSchema), multipleImageUpload],
  }, async (request: any, reply: any) => {
    try {
      const { id: productId } = request.params;
      const processedImages = request.processedImages || [];

      if (processedImages.length === 0) {
        return reply.code(400).send({
          success: false,
          error: "No images processed",
        });
      }

      // Get current product
      const product = await db.query.products.findFirst({
        where: eq(products.id, productId),
      });

      if (!product) {
        return reply.code(404).send({
          success: false,
          error: "Product not found",
        });
      }

      // Prepare image data for storage
      const imageData = {
        variants: processedImages.reduce((acc: any, img: any) => {
          acc[img.originalKey] = {
            urls: img.variants.reduce((urls: any, variant: any) => {
              urls[variant.name] = variant.url;
              return urls;
            }, {}),
            variants: img.variants,
            metadata: img.metadata,
            srcset: img.srcset,
          };
          return acc;
        }, {}),
        uploadedAt: new Date().toISOString(),
        count: processedImages.length,
      };

      // Update product with new images
      const currentImages = product.images ? JSON.parse(product.images) : {};
      const updatedImages = {
        ...currentImages,
        ...imageData.variants,
      };

      await db
        .update(products)
        .set({
          images: JSON.stringify(updatedImages),
          imageVariants: JSON.stringify(imageData),
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId));

      logger.info('Product images uploaded', {
        productId,
        imageCount: processedImages.length,
        totalVariants: processedImages.reduce((sum, img: any) => sum + img.variants.length, 0),
      });

      return reply.code(200).send({
        success: true,
        data: {
          productId,
          images: updatedImages,
          uploaded: processedImages.map((img: any) => ({
            originalKey: img.originalKey,
            urls: img.variants.reduce((acc: any, variant: any) => {
              acc[variant.name] = variant.url;
              return acc;
            }, {}),
            variants: img.variants,
            metadata: img.metadata,
          })),
        },
        message: `Successfully uploaded ${processedImages.length} images`,
      });
    } catch (error: any) {
      logger.error('Failed to upload product images', {
        productId: request.params.id,
        error: error.message,
      });
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to upload images",
      });
    }
  });

  // Delete product image
  fastify.delete<{ Params: ProductIdParams & { imageKey: string } }>("/api/products/:id/images/:imageKey", {
    preHandler: [validateParams(productIdParamsSchema)],
  }, async (request: any, reply: any) => {
    try {
      const { id: productId, imageKey } = request.params;

      // Get current product
      const product = await db.query.products.findFirst({
        where: eq(products.id, productId),
      });

      if (!product) {
        return reply.code(404).send({
          success: false,
          error: "Product not found",
        });
      }

      if (!product.images) {
        return reply.code(404).send({
          success: false,
          error: "No images found for this product",
        });
      }

      const currentImages = JSON.parse(product.images);

      if (!currentImages[imageKey]) {
        return reply.code(404).send({
          success: false,
          error: "Image not found",
        });
      }

      // Remove image from database
      delete currentImages[imageKey];

      // Update image variants metadata
      const currentVariants = product.imageVariants ? JSON.parse(product.imageVariants) : { variants: {} };
      if (currentVariants.variants) {
        delete currentVariants.variants[imageKey];
      }

      await db
        .update(products)
        .set({
          images: JSON.stringify(currentImages),
          imageVariants: JSON.stringify(currentVariants),
          updatedAt: new Date(),
        })
        .where(eq(products.id, productId));

      logger.info('Product image deleted', { productId, imageKey });

      return reply.code(200).send({
        success: true,
        message: "Image deleted successfully",
        data: {
          productId,
          deletedImageKey: imageKey,
        },
      });
    } catch (error: any) {
      logger.error('Failed to delete product image', {
        productId: request.params.id,
        imageKey: request.params.imageKey,
        error: error.message,
      });
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to delete image",
      });
    }
  });

  // Get product images
  fastify.get<{ Params: ProductIdParams }>("/api/products/:id/images", {
    preHandler: [validateParams(productIdParamsSchema)],
  }, async (request: any, reply: any) => {
    try {
      const { id: productId } = request.params;

      const product = await db.query.products.findFirst({
        where: eq(products.id, productId),
        columns: {
          id: true,
          images: true,
          imageVariants: true,
        },
      });

      if (!product) {
        return reply.code(404).send({
          success: false,
          error: "Product not found",
        });
      }

      const images = product.images ? JSON.parse(product.images) : {};
      const variants = product.imageVariants ? JSON.parse(product.imageVariants) : {};

      return reply.code(200).send({
        success: true,
        data: {
          productId,
          images,
          variants,
          count: Object.keys(images).length,
        },
      });
    } catch (error: any) {
      logger.error('Failed to get product images', {
        productId: request.params.id,
        error: error.message,
      });
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get images",
      });
    }
  });
}

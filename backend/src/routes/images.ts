import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { s3Service } from "../lib/aws-s3";
import { imageProcessor, ProcessedImageResult } from "../lib/image-processor";
import { singleImageUpload, multipleImageUpload, batchImageUpload } from "../lib/upload-middleware";
import { logger } from "../lib/logger";

// Extend FastifyRequest to include processed images
declare module "fastify" {
  interface FastifyRequest {
    processedImage?: ProcessedImageResult;
    processedImages?: ProcessedImageResult[];
    uploadProgress?: any;
  }
}

export async function imageRoutes(fastify: FastifyInstance) {
  // Single image upload
  fastify.post("/api/images/upload", {
    preHandler: singleImageUpload,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const processedImage = request.processedImage;

      if (!processedImage) {
        return reply.code(400).send({
          success: false,
          error: "No image processed",
        });
      }

      // Return image URLs and metadata
      const response = {
        success: true,
        data: {
          originalKey: processedImage.originalKey,
          urls: processedImage.variants.reduce((acc: any, variant: any) => {
            acc[variant.name] = variant.url;
            return acc;
          }, {}),
          variants: processedImage.variants,
          metadata: processedImage.metadata,
          srcset: imageProcessor.createSrcSet(processedImage.variants),
        },
      };

      logger.info('Single image upload completed', {
        originalKey: processedImage.originalKey,
        variantsCount: processedImage.variants.length,
      });

      return reply.send(response);
    } catch (error: any) {
      logger.error('Single image upload failed', { error: error.message });
      return reply.code(500).send({
        success: false,
        error: error.message || "Upload failed",
      });
    }
  });

  // Multiple image upload
  fastify.post("/api/images/upload/multiple", {
    preHandler: multipleImageUpload,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const processedImages = request.processedImages || [];

      if (processedImages.length === 0) {
        return reply.code(400).send({
          success: false,
          error: "No images processed",
        });
      }

      // Return all image URLs and metadata
      const response = {
        success: true,
        data: processedImages.map(processedImage => ({
          originalKey: processedImage.originalKey,
          urls: processedImage.variants.reduce((acc: any, variant: any) => {
            acc[variant.name] = variant.url;
            return acc;
          }, {}),
          variants: processedImage.variants,
          metadata: processedImage.metadata,
          srcset: imageProcessor.createSrcSet(processedImage.variants),
        })),
        summary: {
          totalImages: processedImages.length,
          totalVariants: processedImages.reduce((sum, img) => sum + img.variants.length, 0),
        },
      };

      logger.info('Multiple image upload completed', {
        imageCount: processedImages.length,
        totalVariants: response.summary.totalVariants,
      });

      return reply.send(response);
    } catch (error: any) {
      logger.error('Multiple image upload failed', { error: error.message });
      return reply.code(500).send({
        success: false,
        error: error.message || "Upload failed",
      });
    }
  });

  // Batch upload with progress tracking
  fastify.post("/api/images/upload/batch", {
    preHandler: batchImageUpload,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const processedImages = request.processedImages || [];
      const progress = request.uploadProgress;

      const response = {
        success: true,
        data: processedImages.map(processedImage => ({
          originalKey: processedImage.originalKey,
          urls: processedImage.variants.reduce((acc: any, variant: any) => {
            acc[variant.name] = variant.url;
            return acc;
          }, {}),
          variants: processedImage.variants,
          metadata: processedImage.metadata,
          srcset: imageProcessor.createSrcSet(processedImage.variants),
        })),
        progress: progress ? {
          total: progress.total,
          processed: progress.processed,
          errors: progress.errors,
        } : null,
      };

      logger.info('Batch image upload completed', {
        totalFiles: progress?.total || 0,
        processedFiles: processedImages.length,
        errors: progress?.errors?.length || 0,
      });

      return reply.send(response);
    } catch (error: any) {
      logger.error('Batch image upload failed', { error: error.message });
      return reply.code(500).send({
        success: false,
        error: error.message || "Batch upload failed",
      });
    }
  });

  // Get image variants for a specific image
  fastify.get("/api/images/:key/variants", async (request, reply) => {
    try {
      const { key } = request.params as any;
      const { format, quality } = request.query as { format?: string; quality?: string };

      // List all variants for this key
      const objects = await s3Service.listObjects(`images/${key}`);
      const variants = objects.map(obj => ({
        name: obj.split('_').pop()?.split('.')[0] || 'unknown',
        url: s3Service.getPublicUrl(obj),
        key: obj,
      }));

      // If specific format requested, return optimized version
      if (format && quality) {
        // This would generate on-demand variants
        // For now, return existing variants
      }

      return reply.send({
        success: true,
        data: {
          key,
          variants,
          count: variants.length,
        },
      });
    } catch (error: any) {
      logger.error('Failed to get image variants', { key: request.params.key, error: error.message });
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get variants",
      });
    }
  });

  // Delete image and all variants
  fastify.delete("/api/images/:key", async (request, reply) => {
    try {
      const { key } = request.params as any;

      // List all variants
      const objects = await s3Service.listObjects(`images/${key}`);

      if (objects.length === 0) {
        return reply.code(404).send({
          success: false,
          error: "Image not found",
        });
      }

      // Delete all variants
      await Promise.all(objects.map(obj => s3Service.deleteFile(obj)));

      logger.info('Image and variants deleted', {
        key,
        variantsDeleted: objects.length,
      });

      return reply.send({
        success: true,
        message: "Image deleted successfully",
        data: {
          key,
          variantsDeleted: objects.length,
        },
      });
    } catch (error: any) {
      logger.error('Failed to delete image', { key: request.params.key, error: error.message });
      return reply.code(500).send({
        success: false,
        error: error.message || "Delete failed",
      });
    }
  });

  // Get image metadata
  fastify.get("/api/images/:key/metadata", async (request, reply) => {
    try {
      const { key } = request.params as any;

      // List variants to get metadata
      const objects = await s3Service.listObjects(`images/${key}`);

      if (objects.length === 0) {
        return reply.code(404).send({
          success: false,
          error: "Image not found",
        });
      }

      // For now, return basic info (could be enhanced with actual image metadata)
      const variants = objects.map(obj => ({
        name: obj.split('_').pop()?.split('.')[0] || 'unknown',
        url: s3Service.getPublicUrl(obj),
        key: obj,
        size: 'unknown', // Would need to get from S3 head request
      }));

      return reply.send({
        success: true,
        data: {
          key,
          variants,
          totalVariants: variants.length,
          cdnEnabled: s3Service.hasCloudFront(),
        },
      });
    } catch (error: any) {
      logger.error('Failed to get image metadata', { key: request.params.key, error: error.message });
      return reply.code(500).send({
        success: false,
        error: error.message || "Metadata retrieval failed",
      });
    }
  });

  // Image optimization endpoint (convert formats, resize on demand)
  fastify.post("/api/images/optimize", async (request, reply) => {
    try {
      const { imageUrl, width, height, quality, format } = request.body as {
        imageUrl: string;
        width?: number;
        height?: number;
        quality?: number;
        format?: 'webp' | 'jpeg' | 'png' | 'avif';
      };

      if (!imageUrl) {
        return reply.code(400).send({
          success: false,
          error: "imageUrl is required",
        });
      }

      // Download image from URL
      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        return reply.code(400).send({
          success: false,
          error: "Failed to download image from URL",
        });
      }

      const buffer = Buffer.from(await imageResponse.arrayBuffer());

      // Process with specified options
      const options = {
        width,
        height,
        quality: quality || 85,
        format: format || 'webp',
        fit: 'inside' as const,
        withoutEnlargement: true,
      };

      const processedBuffer = await imageProcessor.processImageVariant(buffer, options);

      // Generate optimized filename
      const filename = `optimized_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const key = `optimized/${filename}.${format || 'webp'}`;

      // Upload optimized image
      const url = await s3Service.uploadFile(processedBuffer, {
        bucket: s3Service.getBucketName(),
        key,
        contentType: `image/${format || 'webp'}`,
        cacheControl: 'max-age=86400', // 1 day cache
      });

      logger.info('Image optimized on demand', {
        originalUrl: imageUrl,
        optimizedKey: key,
        options,
      });

      return reply.send({
        success: true,
        data: {
          originalUrl: imageUrl,
          optimizedUrl: url,
          key,
          options,
          size: processedBuffer.length,
        },
      });
    } catch (error: any) {
      logger.error('Image optimization failed', { error: error.message });
      return reply.code(500).send({
        success: false,
        error: error.message || "Optimization failed",
      });
    }
  });
}
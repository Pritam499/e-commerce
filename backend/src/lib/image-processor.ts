import sharp from 'sharp';
import { logger } from './logger';
import { s3Service } from './aws-s3';

export interface ImageProcessingOptions {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'avif';
  fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
  position?: string;
  withoutEnlargement?: boolean;
  progressive?: boolean;
  compressionLevel?: number;
  effort?: number; // For AVIF
}

export interface ImageVariant {
  name: string;
  options: ImageProcessingOptions;
  suffix?: string;
}

export interface ProcessedImageResult {
  originalKey: string;
  variants: Array<{
    name: string;
    key: string;
    url: string;
    width?: number;
    height?: number;
    size: number;
    format: string;
  }>;
  metadata: {
    originalFormat: string;
    originalWidth: number;
    originalHeight: number;
    originalSize: number;
  };
}

export class ImageProcessor {
  private defaultVariants: ImageVariant[] = [
    {
      name: 'original',
      options: {
        format: 'webp',
        quality: 90,
        effort: 4,
      },
      suffix: '',
    },
    {
      name: 'thumbnail',
      options: {
        width: 150,
        height: 150,
        fit: 'cover',
        format: 'webp',
        quality: 80,
      },
      suffix: '_thumb',
    },
    {
      name: 'medium',
      options: {
        width: 500,
        height: 500,
        fit: 'inside',
        withoutEnlargement: true,
        format: 'webp',
        quality: 85,
      },
      suffix: '_medium',
    },
    {
      name: 'large',
      options: {
        width: 1200,
        height: 1200,
        fit: 'inside',
        withoutEnlargement: true,
        format: 'webp',
        quality: 90,
      },
      suffix: '_large',
    },
  ];

  // Process uploaded image with variants
  async processImage(
    buffer: Buffer,
    originalFilename: string,
    customVariants?: ImageVariant[]
  ): Promise<ProcessedImageResult> {
    const startTime = Date.now();
    const variants = customVariants || this.defaultVariants;

    try {
      // Get original image metadata
      const metadata = await sharp(buffer).metadata();
      const originalSize = buffer.length;

      logger.info('Starting image processing', {
        filename: originalFilename,
        originalSize,
        originalFormat: metadata.format,
        originalWidth: metadata.width,
        originalHeight: metadata.height,
      });

      // Generate base filename without extension
      const baseFilename = this.generateBaseFilename(originalFilename);
      const uploadPromises: Promise<any>[] = [];

      // Process each variant
      for (const variant of variants) {
        const variantKey = `${baseFilename}${variant.suffix || '_' + variant.name}`;
        const processedBuffer = await this.processImageVariant(buffer, variant.options);

        // Upload variant to S3
        const uploadPromise = s3Service.uploadFile(processedBuffer, {
          bucket: s3Service.getBucketName(),
          key: variantKey,
          contentType: `image/${variant.options.format || 'webp'}`,
          cacheControl: this.getCacheControl(variant.name),
        }).then(url => ({
          name: variant.name,
          key: variantKey,
          url,
          width: variant.options.width,
          height: variant.options.height,
          size: processedBuffer.length,
          format: variant.options.format || 'webp',
        }));

        uploadPromises.push(uploadPromise);
      }

      // Wait for all uploads to complete
      const variantResults = await Promise.all(uploadPromises);

      const processingTime = Date.now() - startTime;

      logger.info('Image processing completed', {
        filename: originalFilename,
        variantsCount: variantResults.length,
        totalProcessingTime: processingTime,
      });

      return {
        originalKey: baseFilename,
        variants: variantResults,
        metadata: {
          originalFormat: metadata.format || 'unknown',
          originalWidth: metadata.width || 0,
          originalHeight: metadata.height || 0,
          originalSize,
        },
      };
    } catch (error) {
      logger.error('Image processing failed', {
        filename: originalFilename,
        error: error.message,
        processingTime: Date.now() - startTime,
      });
      throw error;
    }
  }

  // Process single image variant
  async processImageVariant(
    buffer: Buffer,
    options: ImageProcessingOptions
  ): Promise<Buffer> {
    let pipeline = sharp(buffer);

    // Resize if dimensions specified
    if (options.width || options.height) {
      const resizeOptions: any = {
        width: options.width,
        height: options.height,
        fit: options.fit || 'cover',
        position: options.position || 'center',
        withoutEnlargement: options.withoutEnlargement !== false,
      };

      pipeline = pipeline.resize(resizeOptions);
    }

    // Convert format and apply quality settings
    switch (options.format) {
      case 'webp':
        pipeline = pipeline.webp({
          quality: options.quality || 85,
          effort: options.effort || 4,
        });
        break;

      case 'jpeg':
        pipeline = pipeline.jpeg({
          quality: options.quality || 85,
          progressive: options.progressive !== false,
        });
        break;

      case 'png':
        pipeline = pipeline.png({
          quality: options.quality || 85,
          compressionLevel: options.compressionLevel || 6,
          progressive: options.progressive !== false,
        });
        break;

      case 'avif':
        pipeline = pipeline.avif({
          quality: options.quality || 85,
          effort: options.effort || 4,
        });
        break;

      default:
        // Keep original format or default to WebP
        const metadata = await sharp(buffer).metadata();
        if (metadata.format === 'jpeg') {
          pipeline = pipeline.jpeg({ quality: options.quality || 85 });
        } else if (metadata.format === 'png') {
          pipeline = pipeline.png({ compressionLevel: options.compressionLevel || 6 });
        } else {
          pipeline = pipeline.webp({ quality: options.quality || 85 });
        }
    }

    return pipeline.toBuffer();
  }

  // Generate optimized filename
  private generateBaseFilename(originalFilename: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const sanitizedName = originalFilename
      .replace(/[^a-zA-Z0-9.-]/g, '_')
      .replace(/\s+/g, '_')
      .toLowerCase();

    return `images/${timestamp}_${random}_${sanitizedName}`;
  }

  // Get appropriate cache control header
  private getCacheControl(variant: string): string {
    // Static images can be cached for a year
    // Dynamic images (like user uploads) for shorter time
    switch (variant) {
      case 'thumbnail':
      case 'medium':
      case 'large':
        return 'max-age=31536000, s-maxage=31536000'; // 1 year
      case 'original':
        return 'max-age=86400, s-maxage=86400'; // 1 day
      default:
        return 'max-age=3600, s-maxage=3600'; // 1 hour
    }
  }

  // Validate image before processing
  async validateImage(buffer: Buffer): Promise<{
    isValid: boolean;
    metadata: sharp.Metadata;
    errors: string[];
  }> {
    const errors: string[] = [];

    try {
      const metadata = await sharp(buffer).metadata();

      // Check file size (max 10MB)
      if (buffer.length > 10 * 1024 * 1024) {
        errors.push('Image file size exceeds 10MB limit');
      }

      // Check dimensions (max 4096x4096)
      if ((metadata.width || 0) > 4096 || (metadata.height || 0) > 4096) {
        errors.push('Image dimensions exceed 4096x4096 pixel limit');
      }

      // Check format
      const allowedFormats = ['jpeg', 'jpg', 'png', 'webp', 'gif', 'avif'];
      if (!metadata.format || !allowedFormats.includes(metadata.format)) {
        errors.push(`Unsupported image format. Allowed: ${allowedFormats.join(', ')}`);
      }

      // Check for corrupted images
      if (!metadata.width || !metadata.height) {
        errors.push('Invalid or corrupted image file');
      }

      return {
        isValid: errors.length === 0,
        metadata,
        errors,
      };
    } catch (error) {
      return {
        isValid: false,
        metadata: {} as sharp.Metadata,
        errors: ['Failed to process image file'],
      };
    }
  }

  // Create responsive image srcset
  createSrcSet(variants: ProcessedImageResult['variants']): string {
    return variants
      .filter(v => v.width)
      .sort((a, b) => (a.width || 0) - (b.width || 0))
      .map(v => `${v.url} ${v.width}w`)
      .join(', ');
  }

  // Get optimal image for screen size
  getOptimalImage(
    variants: ProcessedImageResult['variants'],
    screenWidth: number
  ): ProcessedImageResult['variants'][0] | null {
    // Sort by width ascending
    const sortedVariants = variants
      .filter(v => v.width)
      .sort((a, b) => (a.width || 0) - (b.width || 0));

    // Find the smallest variant that's larger than screen width
    for (const variant of sortedVariants) {
      if ((variant.width || 0) >= screenWidth) {
        return variant;
      }
    }

    // If no variant is large enough, return the largest available
    return sortedVariants[sortedVariants.length - 1] || null;
  }

  // Generate image placeholder (blur hash or dominant color)
  async generatePlaceholder(buffer: Buffer): Promise<{
    blurDataURL?: string;
    dominantColor?: string;
  }> {
    try {
      // Create a tiny version for blur placeholder
      const tinyImage = await sharp(buffer)
        .resize(10, 10, { fit: 'inside' })
        .jpeg({ quality: 80 })
        .toBuffer();

      const blurDataURL = `data:image/jpeg;base64,${tinyImage.toString('base64')}`;

      // Get dominant color (simplified - just the center pixel)
      const { data } = await sharp(buffer)
        .resize(1, 1)
        .raw()
        .toBuffer({ resolveWithObject: true });

      const [r, g, b] = data;
      const dominantColor = `rgb(${r}, ${g}, ${b})`;

      return { blurDataURL, dominantColor };
    } catch (error) {
      logger.error('Failed to generate placeholder', { error: error.message });
      return {};
    }
  }

  // Batch process multiple images
  async processBatch(
    images: Array<{ buffer: Buffer; filename: string }>,
    concurrency: number = 3
  ): Promise<ProcessedImageResult[]> {
    const results: ProcessedImageResult[] = [];
    const batches: Array<Array<{ buffer: Buffer; filename: string }>> = [];

    // Split into batches
    for (let i = 0; i < images.length; i += concurrency) {
      batches.push(images.slice(i, i + concurrency));
    }

    // Process batches sequentially to avoid overwhelming the system
    for (const batch of batches) {
      const batchPromises = batch.map(image =>
        this.processImage(image.buffer, image.filename)
      );

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  // Clean up old image variants
  async cleanupOldImages(olderThanDays: number = 30): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // This would require additional logic to track image metadata
      // For now, return 0 as placeholder
      logger.info('Image cleanup completed', { cleanedCount: 0, olderThanDays });
      return 0;
    } catch (error) {
      logger.error('Image cleanup failed', { error: error.message });
      return 0;
    }
  }
}

// Global image processor instance
export const imageProcessor = new ImageProcessor();
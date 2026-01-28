import multer from 'multer';
import { FastifyRequest, FastifyReply } from 'fastify';
import { imageProcessor, ProcessedImageResult } from './image-processor';
import { logger } from './logger';
import { s3Service } from './aws-s3';

// Configure multer for memory storage
const storage = multer.memoryStorage();

const fileFilter = (req: FastifyRequest, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Check if file is an image
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'));
  }
};

// Create multer instance
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10, // Maximum 10 files at once
  },
});

// Image upload processor middleware
export const processImageUpload = async (
  req: FastifyRequest & { processedImages?: ProcessedImageResult[] },
  res: FastifyReply,
  next: Function
) => {
  if (!req.files || !Array.isArray(req.files)) {
    return next();
  }

  try {
    const imageFiles = req.files as Express.Multer.File[];
    const processedImages: ProcessedImageResult[] = [];

    logger.info('Processing image uploads', { count: imageFiles.length });

    // Validate all images first
    const validationPromises = imageFiles.map(async (file) => {
      const validation = await imageProcessor.validateImage(file.buffer);
      return { file, validation };
    });

    const validations = await Promise.all(validationPromises);
    const invalidImages = validations.filter(v => !v.validation.isValid);

    if (invalidImages.length > 0) {
      const errors = invalidImages.flatMap(v => v.validation.errors);
      return res.status(400).json({
        error: 'Invalid image files',
        details: errors,
      });
    }

    // Process valid images
    const processPromises = validations.map(async ({ file }) => {
      return imageProcessor.processImage(file.buffer, file.originalname);
    });

    const results = await Promise.all(processPromises);
    processedImages.push(...results);

    // Attach processed images to request
    req.processedImages = processedImages;

    logger.info('Image upload processing completed', {
      processedCount: processedImages.length,
      totalVariants: processedImages.reduce((sum, img) => sum + img.variants.length, 0),
    });

    next();
  } catch (error) {
    logger.error('Image processing failed', { error: error.message });
    return res.status(500).json({
      error: 'Image processing failed',
      message: error.message,
    });
  }
};

// Single image upload processor
export const processSingleImageUpload = async (
  req: FastifyRequest & { processedImage?: ProcessedImageResult },
  res: FastifyReply,
  next: Function
) => {
  if (!req.file) {
    return next();
  }

  try {
    const file = req.file as Express.Multer.File;

    // Validate image
    const validation = await imageProcessor.validateImage(file.buffer);
    if (!validation.isValid) {
      return res.status(400).json({
        error: 'Invalid image file',
        details: validation.errors,
      });
    }

    // Process image
    const processedImage = await imageProcessor.processImage(file.buffer, file.originalname);

    // Attach to request
    req.processedImage = processedImage;

    logger.info('Single image processed', {
      filename: file.originalname,
      variantsCount: processedImage.variants.length,
    });

    next();
  } catch (error) {
    logger.error('Single image processing failed', { error: error.message });
    return res.status(500).json({
      error: 'Image processing failed',
      message: error.message,
    });
  }
};

// Batch image upload processor with progress tracking
export const processBatchImageUpload = async (
  req: FastifyRequest & { processedImages?: ProcessedImageResult[]; uploadProgress?: any },
  res: FastifyReply,
  next: Function
) => {
  if (!req.files || !Array.isArray(req.files)) {
    return next();
  }

  try {
    const imageFiles = req.files as Express.Multer.File[];
    const totalFiles = imageFiles.length;

    logger.info('Starting batch image processing', { totalFiles });

    // Progress tracking
    const progress = {
      total: totalFiles,
      processed: 0,
      currentFile: '',
      errors: [] as string[],
    };

    req.uploadProgress = progress;

    // Process images in batches to avoid overwhelming the system
    const batchSize = 3; // Process 3 images at a time
    const results: ProcessedImageResult[] = [];

    for (let i = 0; i < imageFiles.length; i += batchSize) {
      const batch = imageFiles.slice(i, i + batchSize);

      const batchPromises = batch.map(async (file, index) => {
        const globalIndex = i + index;
        progress.currentFile = file.originalname;

        try {
          // Validate
          const validation = await imageProcessor.validateImage(file.buffer);
          if (!validation.isValid) {
            progress.errors.push(`${file.originalname}: ${validation.errors.join(', ')}`);
            return null;
          }

          // Process
          const result = await imageProcessor.processImage(file.buffer, file.originalname);
          progress.processed++;
          return result;
        } catch (error) {
          progress.errors.push(`${file.originalname}: ${error.message}`);
          return null;
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults.filter(Boolean) as ProcessedImageResult[]);
    }

    req.processedImages = results;

    logger.info('Batch image processing completed', {
      totalFiles,
      processedFiles: results.length,
      errors: progress.errors.length,
    });

    next();
  } catch (error) {
    logger.error('Batch image processing failed', { error: error.message });
    return res.status(500).json({
      error: 'Batch image processing failed',
      message: error.message,
    });
  }
};

// Cleanup uploaded images if request fails
export const cleanupOnError = async (
  req: FastifyRequest & { processedImages?: ProcessedImageResult[]; processedImage?: ProcessedImageResult },
  res: FastifyReply,
  next: Function
) => {
  // Store original send method
  const originalSend = res.send;

  // Override send method to cleanup on error responses
  res.send = function(data: any) {
    // Check if response indicates an error (status >= 400)
    if (res.statusCode >= 400) {
      // Cleanup uploaded images
      const imagesToCleanup = req.processedImages || (req.processedImage ? [req.processedImage] : []);

      imagesToCleanup.forEach(async (processedImage) => {
        try {
          // Delete all variants from S3
          await Promise.all(
            processedImage.variants.map(variant =>
              s3Service.deleteFile(variant.key)
            )
          );

          logger.info('Cleaned up failed upload images', {
            originalKey: processedImage.originalKey,
            variantsCount: processedImage.variants.length,
          });
        } catch (cleanupError) {
          logger.error('Failed to cleanup uploaded images', {
            originalKey: processedImage.originalKey,
            error: cleanupError.message,
          });
        }
      });
    }

    // Call original send method
    return originalSend.call(this, data);
  };

  next();
};

// Export configured upload middlewares
export const singleImageUpload = [
  upload.single('image'),
  cleanupOnError,
  processSingleImageUpload,
];

export const multipleImageUpload = [
  upload.array('images', 10),
  cleanupOnError,
  processImageUpload,
];

export const batchImageUpload = [
  upload.array('images', 10),
  cleanupOnError,
  processBatchImageUpload,
];
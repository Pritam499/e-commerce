import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { CloudFrontClient, CreateInvalidationCommand, GetDistributionConfigCommand } from '@aws-sdk/client-cloudfront';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from './logger';

export interface S3UploadOptions {
  bucket: string;
  key: string;
  contentType?: string;
  acl?: 'private' | 'public-read';
  metadata?: Record<string, string>;
  cacheControl?: string;
}

export interface ImageVariant {
  name: string;
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'avif';
}

export class AWSS3Service {
  private s3Client: S3Client;
  private cloudFrontClient: CloudFrontClient;
  private bucketName: string;
  private cloudFrontDomain?: string;
  private cloudFrontDistributionId?: string;

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });

    this.cloudFrontClient = new CloudFrontClient({
      region: process.env.AWS_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
      },
    });

    this.bucketName = process.env.AWS_S3_BUCKET || 'ecommerce-images';
    this.cloudFrontDomain = process.env.AWS_CLOUDFRONT_DOMAIN;
    this.cloudFrontDistributionId = process.env.AWS_CLOUDFRONT_DISTRIBUTION_ID;
  }

  // Upload file to S3
  async uploadFile(buffer: Buffer, options: S3UploadOptions): Promise<string> {
    try {
      const command = new PutObjectCommand({
        Bucket: options.bucket || this.bucketName,
        Key: options.key,
        Body: buffer,
        ContentType: options.contentType,
        ACL: options.acl || 'public-read',
        Metadata: options.metadata,
        CacheControl: options.cacheControl || 'max-age=31536000', // 1 year
      });

      await this.s3Client.send(command);

      const url = this.getPublicUrl(options.key, options.bucket);
      logger.info('File uploaded to S3', { key: options.key, url });

      // Invalidate CloudFront cache if configured
      if (this.cloudFrontDistributionId) {
        await this.invalidateCloudFrontCache([`/${options.key}`]);
      }

      return url;
    } catch (error) {
      logger.error('S3 upload failed', { key: options.key, error: error.message });
      throw error;
    }
  }

  // Get public URL for S3 object
  getPublicUrl(key: string, bucket?: string): string {
    const bucketName = bucket || this.bucketName;

    if (this.cloudFrontDomain) {
      return `https://${this.cloudFrontDomain}/${key}`;
    }

    // Fallback to S3 public URL
    const region = process.env.AWS_REGION || 'us-east-1';
    return `https://${bucketName}.s3.${region}.amazonaws.com/${key}`;
  }

  // Get signed URL for private objects
  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: key,
    });

    try {
      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      return signedUrl;
    } catch (error) {
      logger.error('Failed to generate signed URL', { key, error: error.message });
      throw error;
    }
  }

  // Delete file from S3
  async deleteFile(key: string, bucket?: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: bucket || this.bucketName,
        Key: key,
      });

      await this.s3Client.send(command);

      logger.info('File deleted from S3', { key });

      // Invalidate CloudFront cache
      if (this.cloudFrontDistributionId) {
        await this.invalidateCloudFrontCache([`/${key}`]);
      }
    } catch (error) {
      logger.error('S3 delete failed', { key, error: error.message });
      throw error;
    }
  }

  // List objects in bucket
  async listObjects(prefix?: string): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: prefix,
      });

      const response = await this.s3Client.send(command);
      return (response.Contents || []).map(obj => obj.Key!).filter(Boolean);
    } catch (error) {
      logger.error('Failed to list S3 objects', { prefix, error: error.message });
      return [];
    }
  }

  // Invalidate CloudFront cache
  private async invalidateCloudFrontCache(paths: string[]): Promise<void> {
    if (!this.cloudFrontDistributionId) return;

    try {
      const command = new CreateInvalidationCommand({
        DistributionId: this.cloudFrontDistributionId,
        InvalidationBatch: {
          CallerReference: `invalidate-${Date.now()}`,
          Paths: {
            Quantity: paths.length,
            Items: paths,
          },
        },
      });

      await this.cloudFrontClient.send(command);
      logger.info('CloudFront cache invalidated', { paths });
    } catch (error) {
      logger.error('CloudFront invalidation failed', { paths, error: error.message });
    }
  }

  // Get bucket info
  getBucketName(): string {
    return this.bucketName;
  }

  // Check if CloudFront is configured
  hasCloudFront(): boolean {
    return Boolean(this.cloudFrontDomain && this.cloudFrontDistributionId);
  }
}

// Global S3 service instance
export const s3Service = new AWSS3Service();
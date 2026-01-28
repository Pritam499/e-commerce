"use client";

import { useState, useRef, useCallback } from "react";
import { logger } from "@/src/lib/logger";

interface UploadedImage {
  originalKey: string;
  urls: Record<string, string>;
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
  srcset?: string;
}

interface ImageUploadProps {
  onUploadComplete?: (images: UploadedImage[]) => void;
  onUploadError?: (error: string) => void;
  maxFiles?: number;
  acceptedFormats?: string[];
  maxFileSize?: number; // in MB
  showPreview?: boolean;
  allowMultiple?: boolean;
  className?: string;
}

export default function ImageUpload({
  onUploadComplete,
  onUploadError,
  maxFiles = 5,
  acceptedFormats = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'],
  maxFileSize = 5, // 5MB
  showPreview = true,
  allowMultiple = true,
  className = '',
}: ImageUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [previews, setPreviews] = useState<Array<{ file: File; preview: string; error?: string }>>([]);
  const [uploadedImages, setUploadedImages] = useState<UploadedImage[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validate file
  const validateFile = useCallback((file: File): string | null => {
    if (!acceptedFormats.includes(file.type)) {
      return `Unsupported format. Allowed: ${acceptedFormats.join(', ')}`;
    }

    if (file.size > maxFileSize * 1024 * 1024) {
      return `File too large. Maximum size: ${maxFileSize}MB`;
    }

    return null;
  }, [acceptedFormats, maxFileSize]);

  // Handle file selection
  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;

    const fileArray = Array.from(files);
    const validFiles: File[] = [];
    const newPreviews: Array<{ file: File; preview: string; error?: string }> = [];

    for (const file of fileArray) {
      const error = validateFile(file);
      if (error) {
        newPreviews.push({ file, preview: '', error });
      } else {
        validFiles.push(file);
        // Create preview
        const preview = URL.createObjectURL(file);
        newPreviews.push({ file, preview });
      }
    }

    // Check total file count
    const totalFiles = previews.length + validFiles.length;
    if (totalFiles > maxFiles) {
      onUploadError?.(`Too many files. Maximum allowed: ${maxFiles}`);
      return;
    }

    setPreviews(prev => [...prev, ...newPreviews]);
  }, [previews.length, maxFiles, validateFile, onUploadError]);

  // Upload files
  const uploadFiles = async () => {
    const validPreviews = previews.filter(p => !p.error && p.preview);
    if (validPreviews.length === 0) return;

    setUploading(true);
    const progress: Record<string, number> = {};

    try {
      const formData = new FormData();
      validPreviews.forEach(({ file }, index) => {
        formData.append('images', file);
        progress[file.name] = 0;
      });

      setUploadProgress(progress);

      // Upload endpoint based on number of files
      const endpoint = validPreviews.length === 1
        ? '/api/images/upload'
        : '/api/images/upload/multiple';

      const response = await fetch(`http://localhost:3001${endpoint}`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Upload failed');
      }

      const result = await response.json();

      if (result.success) {
        const uploadedImages = Array.isArray(result.data) ? result.data : [result.data];
        setUploadedImages(uploadedImages);
        setPreviews([]);
        onUploadComplete?.(uploadedImages);

        logger.info('Images uploaded successfully', {
          count: uploadedImages.length,
          totalVariants: uploadedImages.reduce((sum, img) => sum + img.variants.length, 0),
        });
      } else {
        throw new Error(result.error || 'Upload failed');
      }
    } catch (error: any) {
      logger.error('Image upload failed', { error: error.message });
      onUploadError?.(error.message || 'Upload failed');
    } finally {
      setUploading(false);
      setUploadProgress({});
    }
  };

  // Remove preview
  const removePreview = (index: number) => {
    setPreviews(prev => {
      const newPreviews = [...prev];
      const removed = newPreviews.splice(index, 1)[0];

      // Cleanup preview URL
      if (removed.preview && !removed.error) {
        URL.revokeObjectURL(removed.preview);
      }

      return newPreviews;
    });
  };

  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
          isDragging
            ? 'border-indigo-400 bg-indigo-50'
            : 'border-gray-300 hover:border-gray-400'
        } ${uploading ? 'opacity-50 pointer-events-none' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="space-y-4">
          <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>

          <div>
            <p className="text-lg font-medium text-gray-900">
              {isDragging ? 'Drop images here' : 'Upload Images'}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Drag and drop or click to select files
            </p>
            <p className="text-xs text-gray-400 mt-2">
              Max {maxFiles} files, up to {maxFileSize}MB each. Formats: {acceptedFormats.join(', ')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            Select Files
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple={allowMultiple}
          accept={acceptedFormats.join(',')}
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
      </div>

      {/* Previews */}
      {previews.length > 0 && showPreview && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-900">Selected Files</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {previews.map((preview, index) => (
              <div key={index} className="relative">
                {preview.error ? (
                  <div className="aspect-square bg-red-50 border border-red-200 rounded-lg flex items-center justify-center">
                    <div className="text-center p-4">
                      <svg className="w-8 h-8 text-red-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs text-red-600">{preview.error}</p>
                    </div>
                  </div>
                ) : (
                  <div className="aspect-square bg-gray-100 rounded-lg overflow-hidden">
                    <img
                      src={preview.preview}
                      alt={preview.file.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                )}

                <button
                  onClick={() => removePreview(index)}
                  className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-xs hover:bg-red-600"
                >
                  ×
                </button>

                <div className="mt-2 text-xs text-gray-500 text-center">
                  <p className="truncate">{preview.file.name}</p>
                  <p>{formatFileSize(preview.file.size)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload Button */}
      {previews.filter(p => !p.error).length > 0 && (
        <div className="flex justify-center">
          <button
            onClick={uploadFiles}
            disabled={uploading}
            className="px-6 py-3 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50 flex items-center space-x-2"
          >
            {uploading && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            )}
            <span>
              {uploading ? 'Uploading...' : `Upload ${previews.filter(p => !p.error).length} Image${previews.filter(p => !p.error).length !== 1 ? 's' : ''}`}
            </span>
          </button>
        </div>
      )}

      {/* Upload Progress */}
      {uploading && Object.keys(uploadProgress).length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-900">Upload Progress</h4>
          {Object.entries(uploadProgress).map(([filename, progress]) => (
            <div key={filename} className="flex items-center space-x-2">
              <div className="flex-1 bg-gray-200 rounded-full h-2">
                <div
                  className="bg-indigo-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
              <span className="text-sm text-gray-600">{progress}%</span>
            </div>
          ))}
        </div>
      )}

      {/* Uploaded Images */}
      {uploadedImages.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-gray-900">Uploaded Images</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {uploadedImages.map((image, index) => (
              <div key={index} className="border border-gray-200 rounded-lg p-4">
                <div className="aspect-video bg-gray-100 rounded-md mb-3 overflow-hidden">
                  <img
                    src={image.urls.thumbnail || image.urls.original}
                    alt={`Uploaded ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                </div>

                <div className="space-y-2">
                  <div className="text-sm">
                    <span className="font-medium">Original:</span> {image.metadata.originalFormat.toUpperCase()},
                    {image.metadata.originalWidth}×{image.metadata.originalHeight}
                  </div>

                  <div className="text-sm">
                    <span className="font-medium">Variants:</span> {image.variants.length}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {Object.entries(image.urls).map(([variant, url]) => (
                      <a
                        key={variant}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs bg-gray-100 px-2 py-1 rounded hover:bg-gray-200"
                      >
                        {variant}
                      </a>
                    ))}
                  </div>

                  {image.srcset && (
                    <details className="text-xs">
                      <summary className="cursor-pointer">SrcSet</summary>
                      <code className="block mt-1 p-2 bg-gray-100 rounded text-xs break-all">
                        {image.srcset}
                      </code>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
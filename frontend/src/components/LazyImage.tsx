"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { logger } from "@/src/lib/logger";

// Detect WebP support
const supportsWebP = (): boolean => {
  if (typeof window === 'undefined') return true; // Server-side, assume support

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return canvas.toDataURL('image/webp').indexOf('data:image/webp') === 0;
};

// Get optimal image format
const getOptimalImageFormat = (src: string): string => {
  if (!supportsWebP()) return src;

  // If already WebP, return as-is
  if (src.toLowerCase().endsWith('.webp')) return src;

  // Convert other formats to WebP
  return src.replace(/\.(jpg|jpeg|png)(\?.*)?$/i, '.webp$2');
};

interface LazyImageProps {
  src: string;
  alt: string;
  srcset?: string;
  sizes?: string;
  width?: number;
  height?: number;
  className?: string;
  placeholder?: string;
  blurDataURL?: string;
  priority?: boolean; // For above-the-fold images
  quality?: number;
  onLoad?: () => void;
  onError?: (error: Event) => void;
  style?: React.CSSProperties;
  loading?: 'lazy' | 'eager';
  decoding?: 'async' | 'sync' | 'auto';
}

export default function LazyImage({
  src,
  alt,
  srcset,
  sizes,
  width,
  height,
  className = '',
  placeholder,
  blurDataURL,
  priority = false,
  quality = 75,
  onLoad,
  onError,
  style,
  loading = 'lazy',
  decoding = 'async',
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(priority);
  const imgRef = useRef<HTMLImageElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    if (priority || loading === 'eager') {
      setIsInView(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      {
        rootMargin: '50px', // Start loading 50px before image enters viewport
        threshold: 0.01,
      }
    );

    observerRef.current = observer;

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [priority, loading]);

  // Handle image load
  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    setHasError(false);
    onLoad?.();

    logger.debug('Image loaded', { src, alt });
  }, [src, alt, onLoad]);

  // Handle image error
  const handleError = useCallback((error: Event) => {
    setHasError(true);
    setIsLoaded(false);
    onError?.(error);

    logger.warn('Image failed to load', { src, alt, error: error.toString() });
  }, [src, alt, onError]);

  // Generate responsive image attributes
  const getImageAttributes = () => {
    const optimizedSrc = isInView ? getOptimalImageFormat(src) : undefined;

    return {
      src: optimizedSrc,
      srcSet: isInView && srcset ? srcset : undefined,
      sizes: isInView && sizes ? sizes : undefined,
      loading: priority ? 'eager' : loading,
      decoding,
      width,
      height,
    };
  };

  const imageAttributes = getImageAttributes();

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{
        width: width || 'auto',
        height: height || 'auto',
        ...style,
      }}
    >
      {/* Blur placeholder */}
      {blurDataURL && !isLoaded && !hasError && (
        <img
          src={blurDataURL}
          alt=""
          className="absolute inset-0 w-full h-full object-cover filter blur-sm scale-110"
          aria-hidden="true"
        />
      )}

      {/* Regular placeholder */}
      {placeholder && !isInView && !isLoaded && !hasError && (
        <div className="absolute inset-0 bg-gray-200 flex items-center justify-center">
          <div className="text-gray-400 text-sm">{placeholder}</div>
        </div>
      )}

      {/* Main image */}
      <img
        ref={imgRef}
        {...imageAttributes}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={handleLoad}
        onError={handleError}
        style={{
          aspectRatio: width && height ? `${width}/${height}` : undefined,
        }}
      />

      {/* Loading spinner */}
      {!isLoaded && !hasError && isInView && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
        </div>
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="text-center">
            <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-xs text-gray-500">Failed to load image</p>
          </div>
        </div>
      )}

      {/* Priority indicator (dev only) */}
      {process.env.NODE_ENV === 'development' && priority && (
        <div className="absolute top-1 left-1 bg-red-500 text-white text-xs px-1 py-0.5 rounded">
          Priority
        </div>
      )}
    </div>
  );
}

// Progressive Image Component with multiple quality levels
interface ProgressiveImageProps extends Omit<LazyImageProps, 'src' | 'srcset'> {
  src: string;
  lowQualitySrc?: string;
  mediumQualitySrc?: string;
  highQualitySrc?: string;
  srcset?: string;
}

export function ProgressiveImage({
  src,
  lowQualitySrc,
  mediumQualitySrc,
  highQualitySrc,
  ...props
}: ProgressiveImageProps) {
  const [quality, setQuality] = useState<'low' | 'medium' | 'high'>('low');

  useEffect(() => {
    // Start with low quality
    if (lowQualitySrc) {
      setQuality('low');
    }

    // Upgrade to medium after short delay
    const mediumTimer = setTimeout(() => {
      if (mediumQualitySrc) {
        setQuality('medium');
      }
    }, 100);

    // Upgrade to high quality after longer delay
    const highTimer = setTimeout(() => {
      setQuality('high');
    }, 500);

    return () => {
      clearTimeout(mediumTimer);
      clearTimeout(highTimer);
    };
  }, [lowQualitySrc, mediumQualitySrc]);

  const getCurrentSrc = () => {
    switch (quality) {
      case 'low':
        return lowQualitySrc || src;
      case 'medium':
        return mediumQualitySrc || src;
      case 'high':
      default:
        return highQualitySrc || src;
    }
  };

  return (
    <LazyImage
      {...props}
      src={getCurrentSrc()}
      className={`${props.className} transition-all duration-300 ${
        quality === 'low' ? 'filter blur-sm' : ''
      }`}
    />
  );
}

// Optimized Image Component with automatic format selection
interface OptimizedImageProps extends Omit<LazyImageProps, 'src' | 'srcset'> {
  baseSrc: string;
  variants?: {
    thumbnail?: string;
    medium?: string;
    large?: string;
    original?: string;
  };
  sizes?: string;
}

export function OptimizedImage({
  baseSrc,
  variants = {},
  sizes = '(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw',
  width,
  height,
  ...props
}: OptimizedImageProps) {
  // Generate srcset from variants
  const generateSrcSet = () => {
    const srcSetParts: string[] = [];

    if (variants.thumbnail && width && width <= 150) {
      srcSetParts.push(`${getOptimalImageFormat(variants.thumbnail)} 150w`);
    }

    if (variants.medium && width && width <= 500) {
      srcSetParts.push(`${getOptimalImageFormat(variants.medium)} 500w`);
    }

    if (variants.large && width && width <= 1200) {
      srcSetParts.push(`${getOptimalImageFormat(variants.large)} 1200w`);
    }

    if (variants.original) {
      srcSetParts.push(`${getOptimalImageFormat(variants.original)} ${width || 1200}w`);
    }

    // Fallback to base src
    if (srcSetParts.length === 0) {
      return getOptimalImageFormat(baseSrc);
    }

    return srcSetParts.join(', ');
  };

  const srcset = generateSrcSet();

  return (
    <LazyImage
      {...props}
      src={getOptimalImageFormat(baseSrc)}
      srcset={srcset}
      sizes={sizes}
      width={width}
      height={height}
    />
  );
}
"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import {
  fetchProductById,
  fetchSimilarProducts,
  addToCart,
  getCart,
  updateCartItem,
} from "@/src/lib/api";
import Link from "next/link";
import CartPreview from "@/src/components/CartPreview";
<<<<<<< HEAD
import type { Product, CartItem } from "@/src/lib/types";
=======
import LazyImage, { OptimizedImage } from "@/src/components/LazyImage";
>>>>>>> 414560a (Fix: auth with refresh token , added monitoring and other fixes)

export default function ProductDetailPage() {
  const params = useParams();
  const productId = params.id as string;

  const [product, setProduct] = useState<Product | null>(null);
  const [similarProducts, setSimilarProducts] = useState<Product[]>([]);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [cartLoading, setCartLoading] = useState(false);
  const [error, setError] = useState("");
  const [showCartPreview, setShowCartPreview] = useState(false);

  useEffect(() => {
    if (productId) {
      loadProduct();
      loadCart();
    }
  }, [productId]);

  const loadProduct = async () => {
    try {
      setLoading(true);
      const productData = await fetchProductById(productId);
      setProduct(productData);

      const categoryId = productData?.categoryId || productData?.category?.id;
      if (categoryId) {
        try {
          const similar = await fetchSimilarProducts(categoryId, productId, 4);
          setSimilarProducts(similar);
        } catch (err) {
          // Silently fail
        }
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadCart = async () => {
    try {
      const response = await getCart();
      setCartItems(response.data || []);
    } catch (err) {
      // Silently fail
    }
  };

  const getCartQuantity = (pId: string) => {
    const item = cartItems.find((item) => item.productId === pId);
    return item ? item.quantity : 0;
  };

  const handleAddToCart = async () => {
    setCartLoading(true);
    try {
      await addToCart(productId, 1);
      await loadCart();
      setShowCartPreview(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCartLoading(false);
    }
  };

  const handleUpdateQuantity = async (newQuantity: number) => {
    const cartItem = cartItems.find(
      (item) => item.productId === productId
    );
    if (!cartItem) {
      await handleAddToCart();
      return;
    }

    setCartLoading(true);
    try {
      await updateCartItem(cartItem.id, newQuantity);
      await loadCart();
      if (newQuantity > cartItem.quantity) {
        setShowCartPreview(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCartLoading(false);
    }
  };

  const handleAddSimilarToCart = async (similarProductId: string) => {
    setCartLoading(true);
    try {
      await addToCart(similarProductId, 1);
      await loadCart();
      setShowCartPreview(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCartLoading(false);
    }
  };

  const handleUpdateSimilarQuantity = async (
    similarProductId: string,
    newQuantity: number
  ) => {
    const cartItem = cartItems.find(
      (item) => item.productId === similarProductId
    );
    if (!cartItem) {
      await handleAddSimilarToCart(similarProductId);
      return;
    }

    setCartLoading(true);
    try {
      await updateCartItem(cartItem.id, newQuantity);
      await loadCart();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCartLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading product...</div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-red-50 text-red-800 border border-red-200 rounded-lg p-4 mb-4">
            {error || "Product not found"}
          </div>
          <Link href="/">
            <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors">
              Back to Products
            </button>
          </Link>
        </div>
      </div>
    );
  }

  const cartQuantity = getCartQuantity(productId);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        <Link
          href="/"
          className="inline-block mb-6 text-gray-600 hover:text-blue-600 transition-colors"
        >
          ← Back to Products
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Product Images */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            {product.images && Object.keys(product.images).length > 0 ? (
              <div className="space-y-4">
                {/* Main image */}
                <div className="aspect-square">
                  <OptimizedImage
                    baseSrc={product.images[Object.keys(product.images)[0]]?.urls?.medium ||
                             product.images[Object.keys(product.images)[0]]?.urls?.large ||
                             product.images[Object.keys(product.images)[0]]?.urls?.original ||
                             product.image}
                    variants={product.images[Object.keys(product.images)[0]]?.urls}
                    alt={product.name}
                    className="w-full h-full rounded-lg"
                    priority
                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                  />
                </div>

                {/* Thumbnail gallery */}
                {Object.keys(product.images).length > 1 && (
                  <div className="grid grid-cols-4 gap-2">
                    {Object.entries(product.images).slice(0, 4).map(([key, imageData]: [string, any]) => (
                      <div key={key} className="aspect-square cursor-pointer border-2 border-transparent hover:border-blue-500 rounded transition-colors">
                        <LazyImage
                          src={imageData.urls?.thumbnail || imageData.urls?.medium || imageData.urls?.original}
                          alt={`${product.name} thumbnail`}
                          className="w-full h-full rounded object-cover"
                          sizes="25vw"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : product.image ? (
              <div className="aspect-square">
                <LazyImage
                  src={product.image}
                  alt={product.name}
                  className="w-full h-full rounded-lg"
                  priority
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                />
              </div>
            ) : (
              <div className="aspect-square bg-gray-100 rounded-lg flex items-center justify-center text-gray-400">
                No Image
              </div>
            )}
          </div>

          {/* Product Info */}
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-4">
              {product.name}
            </h1>
            <p className="text-sm text-gray-500 uppercase mb-6">
              {product.category?.name || "Uncategorized"}
            </p>

            <div className="mb-6">
              <span className="text-3xl font-bold text-gray-900">
                ${product.price}
              </span>
              {product.stock > 0 && (
                <span className="ml-4 bg-green-100 text-green-800 text-sm font-medium px-3 py-1 rounded">
                  In Stock
                </span>
              )}
            </div>

            {product.description && (
              <div className="mb-8 text-gray-600">
                <h3 className="font-semibold text-gray-900 mb-2">
                  Description
                </h3>
                <p>{product.description}</p>
              </div>
            )}

            {/* Cart Controls */}
            {product.stock === 0 ? (
              <p className="text-red-600 font-medium">Out of Stock</p>
            ) : cartQuantity > 0 ? (
              <div className="flex items-center gap-4">
                <button
                  onClick={() => handleUpdateQuantity(cartQuantity - 1)}
                  disabled={cartLoading}
                  className="w-12 h-12 rounded-lg border-2 border-gray-300 bg-white hover:bg-gray-50 hover:border-blue-500 disabled:opacity-50 flex items-center justify-center font-bold text-gray-700 transition-all active:scale-95"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-20 text-center text-2xl font-bold text-gray-900">
                  {cartQuantity}
                </span>
                <button
                  onClick={() => handleUpdateQuantity(cartQuantity + 1)}
                  disabled={cartLoading || product.stock <= cartQuantity}
                  className="w-12 h-12 rounded-lg border-2 border-gray-300 bg-white hover:bg-gray-50 hover:border-blue-500 disabled:opacity-50 flex items-center justify-center font-bold text-gray-700 transition-all active:scale-95"
                  aria-label="Increase quantity"
                >
                  +
                </button>
              </div>
            ) : (
              <button
                onClick={handleAddToCart}
                disabled={cartLoading || product.stock === 0}
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-8 py-3 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg active:scale-98 flex items-center gap-2"
              >
                {cartLoading ? (
                  <>
                    <svg
                      className="animate-spin h-5 w-5"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      ></circle>
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      ></path>
                    </svg>
                    Adding...
                  </>
                ) : product.stock === 0 ? (
                  "Out of Stock"
                ) : (
                  <>
                    <svg
                      className="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
                      />
                    </svg>
                    Add to Cart
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Similar Products */}
        {similarProducts.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              Similar Products
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {similarProducts.map((similar) => {
                const similarCartQuantity = getCartQuantity(similar.id);
                return (
                  <div
                    key={similar.id}
                    className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
                  >
                    <Link href={`/products/${similar.id}`}>
                      <div className="aspect-square bg-gray-100 p-4 flex items-center justify-center">
                        {similar.images && Object.keys(similar.images).length > 0 ? (
                          <OptimizedImage
                            baseSrc={similar.images[Object.keys(similar.images)[0]]?.urls?.medium ||
                                     similar.images[Object.keys(similar.images)[0]]?.urls?.thumbnail ||
                                     similar.image}
                            variants={similar.images[Object.keys(similar.images)[0]]?.urls}
                            alt={similar.name}
                            className="w-full h-full object-contain"
                            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                          />
                        ) : similar.image ? (
                          <LazyImage
                            src={similar.image}
                            alt={similar.name}
                            className="w-full h-full object-contain"
                            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                          />
                        ) : (
                          <div className="text-gray-400 text-sm">No Image</div>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="font-medium text-gray-900 mb-1 line-clamp-2 min-h-12">
                          {similar.name}
                        </h3>
                        <p className="text-xs text-gray-500 uppercase mb-2">
                          {similar.category?.name || "Uncategorized"}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="text-xl font-bold text-gray-900">
                            ${similar.price}
                          </span>
                        </div>
                      </div>
                    </Link>
                    {similarCartQuantity > 0 ? (
                      <div className="px-4 pb-4">
                        <div className="flex items-center justify-center gap-3">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              handleUpdateSimilarQuantity(
                                similar.id,
                                similarCartQuantity - 1
                              );
                            }}
                            disabled={cartLoading}
                            className="w-9 h-9 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center font-semibold text-gray-700"
                          >
                            −
                          </button>
                          <span className="w-12 text-center font-semibold text-gray-900">
                            {similarCartQuantity}
                          </span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              handleUpdateSimilarQuantity(
                                similar.id,
                                similarCartQuantity + 1
                              );
                            }}
                            disabled={
                              cartLoading ||
                              (similar.stock || 0) <= similarCartQuantity
                            }
                            className="w-9 h-9 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center font-semibold text-gray-700"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 pb-4">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            handleAddSimilarToCart(similar.id);
                          }}
                          disabled={cartLoading || (similar.stock || 0) === 0}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {cartLoading
                            ? "Adding..."
                            : (similar.stock || 0) === 0
                              ? "Out of Stock"
                              : "Add to Cart"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Cart Preview */}
      <CartPreview
        isOpen={showCartPreview}
        onClose={() => setShowCartPreview(false)}
      />
    </div>
  );
}

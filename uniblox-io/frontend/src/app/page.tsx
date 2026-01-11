"use client";

import { useState, useEffect } from "react";
import {
  addToCart,
  fetchProducts,
  getCart,
  updateCartItem,
} from "@/src/lib/api";
import Link from "next/link";
import CartPreview from "@/src/components/CartPreview";
import {
  ProductCardSkeleton,
  PageSkeleton,
} from "@/src/components/LoadingSkeleton";

export default function Home() {
  const [products, setProducts] = useState<any[]>([]);
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [pagination, setPagination] = useState<any>({});
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState<{ [key: number]: boolean }>({});
  const [message, setMessage] = useState("");
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [showCartPreview, setShowCartPreview] = useState(false);

  useEffect(() => {
    loadProducts(currentPage);
    loadCart();
  }, [currentPage]);

  const loadProducts = async (page: number) => {
    try {
      setLoadingProducts(true);
      const result = await fetchProducts(page, 10);
      setProducts(result.products);
      setPagination(result.pagination);
    } catch (error: any) {
      setMessage(`Error loading products: ${error.message}`);
    } finally {
      setLoadingProducts(false);
    }
  };

  const loadCart = async () => {
    try {
      const response = await getCart();
      setCartItems(response.data || []);
    } catch (error) {
      // Silently fail
    }
  };

  const getCartQuantity = (productId: number) => {
    const item = cartItems.find((item: any) => item.productId === productId);
    return item ? item.quantity : 0;
  };

  const handleAddToCart = async (productId: number) => {
    setLoading({ ...loading, [productId]: true });
    setMessage("");
    try {
      await addToCart(productId, 1);
      await loadCart();
      setMessage("Item added to cart!");
      setShowCartPreview(true);
      setTimeout(() => setMessage(""), 2000);
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading({ ...loading, [productId]: false });
    }
  };

  const handleUpdateQuantity = async (
    productId: number,
    newQuantity: number
  ) => {
    const cartItem = cartItems.find(
      (item: any) => item.productId === productId
    );
    if (!cartItem) {
      await handleAddToCart(productId);
      return;
    }

    setLoading({ ...loading, [productId]: true });
    try {
      await updateCartItem(cartItem.id, newQuantity);
      await loadCart();
      if (newQuantity > cartItem.quantity) {
        setShowCartPreview(true);
      }
    } catch (error: any) {
      setMessage(`Error: ${error.message}`);
    } finally {
      setLoading({ ...loading, [productId]: false });
    }
  };

  const handlePageChange = (page: number) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {message && (
          <div
            className={`mb-6 p-4 rounded-lg animate-slide-down ${
              message.includes("Error")
                ? "bg-red-50 text-red-800 border border-red-200"
                : "bg-green-50 text-green-800 border border-green-200"
            }`}
          >
            {message}
          </div>
        )}

        {loadingProducts ? (
          <PageSkeleton />
        ) : products.length === 0 ? (
          <div className="text-center py-20">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              No products available
            </h3>
            <p className="text-gray-600">Please check back later.</p>
          </div>
        ) : (
          <>
            {/* Products Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mb-12">
              {products.map((product) => {
                const cartQuantity = getCartQuantity(product.id);
                return (
                  <div
                    key={product.id}
                    className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition-all duration-300 transform hover:-translate-y-1"
                  >
                    <Link href={`/products/${product.id}`}>
                      <div className="aspect-square bg-gray-100 p-4 flex items-center justify-center">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            className="w-full h-full object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).src =
                                "https://via.placeholder.com/300x300?text=No+Image";
                            }}
                          />
                        ) : (
                          <div className="text-gray-400 text-sm">No Image</div>
                        )}
                      </div>
                      <div className="p-4">
                        <h3 className="font-medium text-gray-900 mb-1 line-clamp-2 min-h-12">
                          {product.name}
                        </h3>
                        <p className="text-xs text-gray-500 uppercase mb-2">
                          {product.category?.name || "Uncategorized"}
                        </p>
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xl font-bold text-gray-900">
                            ${product.price}
                          </span>
                          {product.stock > 0 && (
                            <span className="bg-green-100 text-green-800 text-xs font-medium px-2 py-1 rounded">
                              In Stock
                            </span>
                          )}
                        </div>
                      </div>
                    </Link>
                    {cartQuantity > 0 ? (
                      <div className="px-4 pb-4">
                        <div className="flex items-center justify-center gap-3">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              handleUpdateQuantity(
                                product.id,
                                cartQuantity - 1
                              );
                            }}
                            disabled={loading[product.id]}
                            className="w-10 h-10 rounded-lg border-2 border-gray-300 bg-white hover:bg-gray-50 hover:border-blue-500 disabled:opacity-50 flex items-center justify-center font-bold text-gray-700 transition-all active:scale-95"
                            aria-label="Decrease quantity"
                          >
                            −
                          </button>
                          <span className="w-14 text-center font-bold text-lg text-gray-900">
                            {cartQuantity}
                          </span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              handleUpdateQuantity(
                                product.id,
                                cartQuantity + 1
                              );
                            }}
                            disabled={
                              loading[product.id] ||
                              product.stock <= cartQuantity
                            }
                            className="w-10 h-10 rounded-lg border-2 border-gray-300 bg-white hover:bg-gray-50 hover:border-blue-500 disabled:opacity-50 flex items-center justify-center font-bold text-gray-700 transition-all active:scale-95"
                            aria-label="Increase quantity"
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
                            handleAddToCart(product.id);
                          }}
                          disabled={loading[product.id] || product.stock === 0}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-md hover:shadow-lg active:scale-98 flex items-center justify-center gap-2"
                        >
                          {loading[product.id] ? (
                            <>
                              <svg
                                className="animate-spin h-4 w-4"
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
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            {pagination.totalPages > 1 && (
              <div className="flex items-center justify-center gap-4">
                <button
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={!pagination.hasPrev || loadingProducts}
                  className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-gray-700"
                >
                  Previous
                </button>
                <div className="text-gray-600 font-medium">
                  Page {pagination.page} of {pagination.totalPages} (
                  {pagination.total} products)
                </div>
                <button
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={!pagination.hasNext || loadingProducts}
                  className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed font-medium text-gray-700"
                >
                  Next
                </button>
              </div>
            )}
          </>
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

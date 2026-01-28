"use client";

import { useState, useEffect } from "react";
import {
  getCart,
  updateCartItem,
  removeCartItem,
  getAvailableDiscountCodes,
  fetchSimilarProducts,
  addToCart,
  previewDiscount,
  checkDiscountEligibility,
} from "@/src/lib/api";
import Link from "next/link";
import { useRouter } from "next/navigation";
import EmptyState from "@/src/components/EmptyState";
import RealTimeCart from "@/src/components/RealTimeCart";
import ProductInventory from "@/src/components/ProductInventory";

export default function CartPage() {
  const router = useRouter();
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [availableDiscounts, setAvailableDiscounts] = useState<any[]>([]);
  const [selectedDiscount, setSelectedDiscount] = useState<string>("");
  const [appliedDiscount, setAppliedDiscount] = useState<string>("");
  const [discountPreview, setDiscountPreview] = useState<any>(null);
  const [loading, setLoading] = useState<{ [key: number]: boolean }>({});
  const [error, setError] = useState("");
  const [discountMessage, setDiscountMessage] = useState("");
  const [similarProducts, setSimilarProducts] = useState<any[]>([]);
  const [loadingSimilar, setLoadingSimilar] = useState(false);
  const [applyingDiscount, setApplyingDiscount] = useState(false);
  const [isEligibleForDiscount, setIsEligibleForDiscount] = useState(false);

  useEffect(() => {
    loadCart();
    loadDiscountCodes();
    checkEligibility();
  }, []);

  const checkEligibility = async () => {
    try {
      const response = await checkDiscountEligibility();
      setIsEligibleForDiscount(response.data?.eligible || false);
    } catch (err) {
      // Silently fail
      setIsEligibleForDiscount(false);
    }
  };

  useEffect(() => {
    if (cartItems.length > 0) {
      loadSimilarProducts();
    } else {
      setSimilarProducts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cartItems.length]);

  const loadCart = async () => {
    try {
      const response = await getCart();
      setCartItems(response.data || []);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const loadDiscountCodes = async () => {
    try {
      const response = await getAvailableDiscountCodes();
      setAvailableDiscounts(response.data || []);
      if (response.data && response.data.length > 0) {
        setSelectedDiscount(response.data[0].code);
      }
    } catch (err) {
      // Silently fail
    }
  };

  const loadSimilarProducts = async () => {
    if (cartItems.length === 0) return;

    setLoadingSimilar(true);
    try {
      // Get unique categories from cart items
      const categories = new Set<number>();
      cartItems.forEach((item) => {
        const catId = item.product?.categoryId || item.product?.category?.id;
        if (catId) categories.add(catId);
      });

      // Fetch similar products from the first category
      const firstCategory = Array.from(categories)[0];
      if (firstCategory) {
        // Get product IDs to exclude
        const excludeIds = cartItems.map((item) => item.productId);
        const similar = await fetchSimilarProducts(firstCategory, 0, 8);
        // Filter out products already in cart
        const filtered = similar.filter((p: any) => !excludeIds.includes(p.id));
        setSimilarProducts(filtered.slice(0, 4));
      }
    } catch (err) {
      // Silently fail
    } finally {
      setLoadingSimilar(false);
    }
  };

  const getCartQuantity = (productId: number) => {
    const item = cartItems.find((item: any) => item.productId === productId);
    return item ? item.quantity : 0;
  };

  const handleAddSimilarToCart = async (productId: number) => {
    try {
      await addToCart(productId, 1);
      await loadCart();
    } catch (err: any) {
      setError(err.message || "Failed to add product to cart");
    }
  };


  const handleUpdateQuantity = async (
    cartItemId: number,
    newQuantity: number
  ) => {
    setLoading({ ...loading, [cartItemId]: true });
    setError(""); // Clear previous errors
    try {
      if (newQuantity === 0) {
        await removeCartItem(cartItemId);
      } else {
        await updateCartItem(cartItemId, newQuantity);
      }
      await loadCart();
      setError(""); // Clear error on success
    } catch (err: any) {
      const errorMessage = err.message || "Failed to update cart item";
      setError(errorMessage);
      // Auto-clear error after 5 seconds
      setTimeout(() => setError(""), 5000);
    } finally {
      setLoading({ ...loading, [cartItemId]: false });
    }
  };

  const subtotal = cartItems.reduce((sum, item) => {
    return sum + Number(item.product?.price || 0) * item.quantity;
  }, 0);

  // Use preview discount if applied, otherwise calculate from available discounts
  const discountAmount = discountPreview?.valid
    ? discountPreview.discountAmount
    : appliedDiscount && availableDiscounts.length > 0
    ? (subtotal * (availableDiscounts.find((d: any) => d.code === appliedDiscount)?.discountPercentage || 0)) / 100
    : 0;

  const total = discountPreview?.valid
    ? discountPreview.total
    : subtotal - discountAmount;

  const handleApplyDiscount = async () => {
    if (!selectedDiscount || subtotal === 0) return;
    
    setApplyingDiscount(true);
    setError("");
    try {
      const result = await previewDiscount(selectedDiscount, subtotal);
      if (result.success && result.data?.valid) {
        setAppliedDiscount(selectedDiscount);
        setDiscountPreview(result.data);
        setDiscountMessage(`Discount "${selectedDiscount}" applied successfully!`);
        setTimeout(() => setDiscountMessage(""), 3000);
      } else {
        setError(result.data?.message || "Invalid discount code");
        setDiscountPreview(null);
        setAppliedDiscount("");
      }
    } catch (err: any) {
      setError(err.message || "Failed to apply discount code");
      setDiscountPreview(null);
      setAppliedDiscount("");
    } finally {
      setApplyingDiscount(false);
    }
  };

  const handleCancelDiscount = () => {
    setAppliedDiscount("");
    setDiscountPreview(null);
    setSelectedDiscount("");
    setDiscountMessage("Discount removed");
    setTimeout(() => setDiscountMessage(""), 3000);
  };

  const handleProceedToCheckout = () => {
    router.push(`/checkout?discount=${appliedDiscount || selectedDiscount || ""}`);
  };

  const cartIcon = (
    <svg
      className="w-24 h-24 text-gray-300"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
      />
    </svg>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Shopping Cart</h1>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-800 border border-red-200 rounded-lg animate-slide-down">
            Error: {error}
          </div>
        )}

        {cartItems.length === 0 ? (
          <EmptyState
            icon={cartIcon}
            title="Your cart is empty"
            description="Start shopping to add items to your cart and enjoy great deals!"
            actionLabel="Continue Shopping"
            actionHref="/"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Cart Items - Card Layout */}
            <div className="lg:col-span-2 space-y-4">
              {cartItems.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow duration-200"
                >
                  <div className="flex flex-col sm:flex-row gap-4">
                    {/* Product Image */}
                    <Link
                      href={`/products/${item.productId}`}
                      className="shrink-0"
                    >
                      {item.product?.image ? (
                        <img
                          src={item.product.image}
                          alt={item.product.name}
                          className="w-24 h-24 sm:w-32 sm:h-32 object-contain rounded-lg bg-gray-100"
                        />
                      ) : (
                        <div className="w-24 h-24 sm:w-32 sm:h-32 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-sm">
                          No Image
                        </div>
                      )}
                    </Link>

                    {/* Product Info */}
                    <div className="flex-1 min-w-0">
                      <Link href={`/products/${item.productId}`}>
                        <h3 className="font-semibold text-gray-900 mb-1 hover:text-blue-600 transition-colors">
                          {item.product?.name || "Unknown"}
                        </h3>
                      </Link>
                      <p className="text-sm text-gray-500 mb-2">
                        {item.product?.category?.name || "Uncategorized"}
                      </p>
                      <p className="text-lg font-semibold text-gray-900 mb-2">
                        ${item.product?.price || "0.00"} each
                      </p>

                      {/* Real-time Inventory Status */}
                      <div className="mb-4">
                        <ProductInventory
                          productId={item.productId}
                          initialStock={item.product?.stock || 0}
                          onStockChange={(newStock, previousStock, reason) => {
                            // Handle stock changes (e.g., show notification)
                            console.log(`Stock changed for ${item.product?.name}: ${previousStock} → ${newStock} (${reason})`);
                          }}
                        />
                      </div>

                      {/* Quantity Controls */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() =>
                              handleUpdateQuantity(item.id, item.quantity - 1)
                            }
                            disabled={loading[item.id]}
                            className="w-10 h-10 rounded-lg border-2 border-gray-300 bg-white hover:bg-gray-50 hover:border-blue-500 disabled:opacity-50 flex items-center justify-center font-bold text-gray-700 transition-all active:scale-95"
                            aria-label="Decrease quantity"
                          >
                            −
                          </button>
                          <span className="w-14 text-center font-bold text-lg text-gray-900">
                            {item.quantity}
                          </span>
                          <button
                            onClick={() =>
                              handleUpdateQuantity(item.id, item.quantity + 1)
                            }
                            disabled={
                              loading[item.id] ||
                              (item.product?.stock || 0) <= item.quantity
                            }
                            className="w-10 h-10 rounded-lg border-2 border-gray-300 bg-white hover:bg-gray-50 hover:border-blue-500 disabled:opacity-50 flex items-center justify-center font-bold text-gray-700 transition-all active:scale-95"
                            aria-label="Increase quantity"
                          >
                            +
                          </button>
                        </div>

                        {/* Item Total */}
                        <div className="text-right">
                          <p className="text-sm text-gray-500">Total</p>
                          <p className="text-xl font-bold text-blue-600">
                            $
                            {(
                              Number(item.product?.price || 0) * item.quantity
                            ).toFixed(2)}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sticky top-24 space-y-6">
                <h2 className="text-xl font-bold text-gray-900">
                  Order Summary
                </h2>

                {/* Coupon/Discount Code Section */}
                <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                  {/* Green message when eligible for nth order discount */}
                  {isEligibleForDiscount && !appliedDiscount && (
                    <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-green-700 font-semibold text-sm flex items-center gap-2">
                        <svg
                          className="w-5 h-5 text-green-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                        Generate coupon for more discount on this order
                      </p>
                    </div>
                  )}
                  <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
                    <svg
                      className="w-5 h-5 text-blue-600"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    Coupon Code
                  </h3>

                  {discountMessage && (
                    <div
                      className={`mb-3 p-3 rounded-lg text-sm ${
                        discountMessage.includes("Error") ||
                        discountMessage.includes("Failed")
                          ? "bg-red-50 text-red-800 border border-red-200"
                          : "bg-green-50 text-green-800 border border-green-200"
                      }`}
                    >
                      {discountMessage}
                    </div>
                  )}

                  {availableDiscounts.length > 0 ? (
                    <div className="space-y-3">
                      {/* Discount Code Selection */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Select Discount Code
                        </label>
                        <select
                          value={selectedDiscount}
                          onChange={(e) => setSelectedDiscount(e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                        >
                          <option value="">Select a code...</option>
                          {availableDiscounts.map((discount: any) => (
                            <option key={discount.id} value={discount.code}>
                              {discount.code} - {discount.discountPercentage}% off
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Apply/Cancel Buttons */}
                      {appliedDiscount ? (
                        <div className="space-y-2">
                          <div className="p-3 bg-linear-to-r from-green-500 to-emerald-600 text-white rounded-lg">
                            <div className="flex items-center justify-between mb-1">
                            </div>
                            <div className="text-xs mb-1">
                              Code:{" "}
                              <span className="font-mono font-bold">
                                {appliedDiscount}
                              </span>
                            </div>
                            <div className="text-xs text-green-50">
                              Save {discountPreview?.discountPercentage || availableDiscounts.find((d: any) => d.code === appliedDiscount)?.discountPercentage}% ($
                              {discountAmount.toFixed(2)})
                            </div>
                          </div>
                          <button
                            onClick={handleCancelDiscount}
                            className="w-full bg-red-500 hover:bg-red-600 text-white font-medium py-2 rounded-lg transition-colors text-sm"
                          >
                            Cancel Discount
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={handleApplyDiscount}
                          disabled={!selectedDiscount || applyingDiscount || subtotal === 0}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 rounded-lg transition-colors text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {applyingDiscount ? "Applying..." : "Apply"}
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-gray-600">
                        {isEligibleForDiscount 
                          ? "Complete your checkout to receive a discount code automatically! You can then apply it to your next order."
                          : "No discount code available. Discount codes are generated automatically after your nth order is completed. You can apply them when available."
                        }
                      </p>
                    </div>
                  )}
                </div>

                <div className="space-y-4 mb-6">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal</span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  {discountAmount > 0 && appliedDiscount && (
                    <div className="flex justify-between text-green-600">
                      <span>
                        Discount ({discountPreview?.discountPercentage || availableDiscounts.find((d: any) => d.code === appliedDiscount)?.discountPercentage}%)
                      </span>
                      <span>-${discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-200 pt-4">
                    <div className="flex justify-between text-lg font-bold text-gray-900">
                      <span>Total</span>
                      <span>${total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Link href="/">
                    <button className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-3 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md">
                      Continue Shopping
                    </button>
                  </Link>
                  <button
                    onClick={handleProceedToCheckout}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg active:scale-98"
                  >
                    Proceed to Checkout
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Similar Products Section */}
        {cartItems.length > 0 && similarProducts.length > 0 && (
          <div className="mt-12">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">
              You May Also Like
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {similarProducts.map((product) => {
                const cartQuantity = getCartQuantity(product.id);
                const cartItem = cartItems.find(
                  (item: any) => item.productId === product.id
                );
                return (
                  <div
                    key={product.id}
                    className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
                  >
                    <Link href={`/products/${product.id}`}>
                      <div className="aspect-square bg-gray-100 p-4 flex items-center justify-center">
                        {product.image ? (
                          <img
                            src={product.image}
                            alt={product.name}
                            className="w-full h-full object-contain"
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
                        </div>
                      </div>
                    </Link>
                    <div className="px-4 pb-4">
                      {cartQuantity > 0 ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              if (cartItem) {
                                handleUpdateQuantity(
                                  cartItem.id,
                                  cartQuantity - 1
                                );
                              }
                            }}
                            disabled={loading[cartItem?.id || 0]}
                            className="flex-1 w-10 h-10 rounded-lg border-2 border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center font-bold text-gray-700"
                          >
                            −
                          </button>
                          <span className="w-12 text-center font-semibold text-gray-900">
                            {cartQuantity}
                          </span>
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              if (cartItem) {
                                handleUpdateQuantity(
                                  cartItem.id,
                                  cartQuantity + 1
                                );
                              }
                            }}
                            disabled={
                              loading[cartItem?.id || 0] ||
                              (product.stock || 0) <= cartQuantity
                            }
                            className="flex-1 w-10 h-10 rounded-lg border-2 border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50 flex items-center justify-center font-bold text-gray-700"
                          >
                            +
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            handleAddSimilarToCart(product.id);
                          }}
                          disabled={loadingSimilar}
                          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          Add to Cart
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

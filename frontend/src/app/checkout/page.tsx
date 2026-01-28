"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getCart, checkout, getAvailableDiscountCodes } from "@/src/lib/api";
import Link from "next/link";
import EmptyState from "@/src/components/EmptyState";
import type { CartItem, DiscountCode } from "@/src/lib/types";

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [availableDiscounts, setAvailableDiscounts] = useState<DiscountCode[]>([]);
  const [selectedDiscount, setSelectedDiscount] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    const discountParam = searchParams.get("discount");
    loadCart();
    loadDiscountCodes().then(() => {
      if (discountParam) {
        setSelectedDiscount(discountParam);
      }
    });
  }, [searchParams]);

  const loadCart = async () => {
    try {
      const response = await getCart();
      setCartItems(response.data || []);
      if (response.data.length === 0) {
        router.push("/cart");
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const loadDiscountCodes = async () => {
    try {
      const response = await getAvailableDiscountCodes();
      const discounts = response.data || [];
      setAvailableDiscounts(discounts);
      if (discounts.length > 0 && !selectedDiscount) {
        setSelectedDiscount(discounts[0].code);
      }
    } catch (err) {
      // Silently fail
    }
  };

  const handleCheckout = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await checkout(selectedDiscount || undefined);
      setSuccess(true);
      setOrderId(result.data?.orderNumber || result.data?.id || null);
      setTimeout(() => {
        router.push("/orders");
      }, 2000);
    } catch (err) {
      setError((err as Error).message || "Checkout failed");
    } finally {
      setLoading(false);
    }
  };

  const subtotal = cartItems.reduce((sum, item) => {
    return sum + Number(item.product?.price || 0) * item.quantity;
  }, 0);

  const discountAmount =
    selectedDiscount && availableDiscounts.length > 0
      ? (subtotal * (availableDiscounts[0].discountPercentage)) / 100
      : 0;

  const total = subtotal - discountAmount;

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-8 max-w-md text-center animate-slide-down">
          <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
            <svg
              className="w-10 h-10 text-green-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Order Placed Successfully!
          </h2>
          <p className="text-gray-600 mb-2">
            Your order ID is{" "}
            <span className="font-bold text-blue-600">#{orderId}</span>
          </p>
          <p className="text-sm text-gray-500 mb-4">
            Redirecting to orders page...
          </p>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full animate-progress"
              style={{ width: "100%" }}
            ></div>
          </div>
        </div>
      </div>
    );
  }

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
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Checkout</h1>

        {error && (
          <div className="mb-6 p-4 bg-red-50 text-red-800 border border-red-200 rounded-lg animate-slide-down">
            Error: {error}
          </div>
        )}

        {cartItems.length === 0 ? (
          <EmptyState
            icon={cartIcon}
            title="Your cart is empty"
            description="Add items to your cart before proceeding to checkout."
            actionLabel="Go to Cart"
            actionHref="/cart"
          />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Order Items */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">
                  Order Items
                </h2>
                <div className="space-y-4">
                  {cartItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center gap-4 pb-4 border-b border-gray-200 last:border-0"
                    >
                      {item.product?.image ? (
                        <img
                          src={item.product.image}
                          alt={item.product.name}
                          className="w-24 h-24 object-contain rounded-lg bg-gray-100 shrink-0"
                        />
                      ) : (
                        <div className="w-24 h-24 bg-gray-100 rounded-lg flex items-center justify-center text-gray-400 text-sm shrink-0">
                          No Image
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-gray-900 mb-1">
                          {item.product?.name || "Unknown"}
                        </h3>
                        <p className="text-sm text-gray-500 mb-2">
                          {item.product?.category?.name || "Uncategorized"}
                        </p>
                        <div className="flex items-center gap-4">
                          <span className="text-gray-600">
                            Qty:{" "}
                            <span className="font-semibold">
                              {item.quantity}
                            </span>
                          </span>
                          <span className="text-gray-700 font-medium">
                            ${item.product?.price || "0.00"} each
                          </span>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-lg font-bold text-blue-600">
                          $
                          {(
                            Number(item.product?.price || 0) * item.quantity
                          ).toFixed(2)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Order Summary */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sticky top-24">
                <h2 className="text-xl font-bold text-gray-900 mb-6">
                  Order Summary
                </h2>

                <div className="space-y-4 mb-6">
                  <div className="flex justify-between text-gray-600">
                    <span>
                      Subtotal (
                      {cartItems.reduce((sum, item) => sum + item.quantity, 0)}{" "}
                      items)
                    </span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Discount</span>
                      <span>-${discountAmount.toFixed(2)}</span>
                    </div>
                  )}
                  <div className="border-t border-gray-200 pt-4">
                    <div className="flex justify-between text-2xl font-bold text-gray-900">
                      <span>Total</span>
                      <span>${total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <Link href="/cart">
                    <button className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-3 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md">
                      Back to Cart
                    </button>
                  </Link>
                  <button
                    onClick={handleCheckout}
                    disabled={loading}
                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
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
                        Processing...
                      </>
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
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Place Order
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-gray-600">Loading...</div>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}

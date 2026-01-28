"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { persistentCartManager } from "@/src/lib/cart-persistence";
import Link from "next/link";

export default function CartRecoveryPage() {
  const params = useParams();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveredItems, setRecoveredItems] = useState<any[]>([]);

  const recoveryToken = params.token as string;

  useEffect(() => {
    if (!recoveryToken) {
      setError("Invalid recovery link");
      setIsLoading(false);
      return;
    }

    recoverCart();
  }, [recoveryToken]);

  const recoverCart = async () => {
    try {
      setIsLoading(true);
      const success = await persistentCartManager.recoverCart(recoveryToken);

      if (success) {
        const items = persistentCartManager.getItems();
        setRecoveredItems(items);
        setIsSuccess(true);

        // Redirect to cart after a delay
        setTimeout(() => {
          router.push('/cart');
        }, 3000);
      } else {
        setError("Unable to recover cart. The recovery link may have expired.");
      }
    } catch (err) {
      setError("An error occurred while recovering your cart. Please try again.");
      console.error("Cart recovery error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Recovering Your Cart</h2>
          <p className="text-gray-600">Please wait while we restore your items...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Recovery Failed</h2>
          <p className="text-gray-600 mb-6">{error}</p>
          <div className="space-y-3">
            <Link href="/cart">
              <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors">
                Go to Cart
              </button>
            </Link>
            <Link href="/">
              <button className="w-full bg-gray-100 hover:bg-gray-200 text-gray-900 font-semibold py-2 px-4 rounded-lg transition-colors">
                Continue Shopping
              </button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-md p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Cart Recovered Successfully!</h2>
          <p className="text-gray-600 mb-4">
            We found and restored {recoveredItems.length} item{recoveredItems.length !== 1 ? 's' : ''} to your cart.
          </p>

          {recoveredItems.length > 0 && (
            <div className="bg-gray-50 rounded-lg p-3 mb-6 text-left">
              <h3 className="text-sm font-medium text-gray-900 mb-2">Recovered Items:</h3>
              <ul className="text-sm text-gray-600 space-y-1">
                {recoveredItems.slice(0, 3).map((item, index) => (
                  <li key={index}>
                    {item.product?.name || 'Unknown Item'} (x{item.quantity})
                  </li>
                ))}
                {recoveredItems.length > 3 && (
                  <li>...and {recoveredItems.length - 3} more</li>
                )}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            <Link href="/cart">
              <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors">
                View Cart
              </button>
            </Link>
            <p className="text-xs text-gray-500">Redirecting to cart in a few seconds...</p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
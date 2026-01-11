"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { getCart } from "@/src/lib/api";

interface CartPreviewProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CartPreview({ isOpen, onClose }: CartPreviewProps) {
  const [cartItems, setCartItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadCart();
      // Auto-dismiss after 5 seconds
      const timer = setTimeout(() => {
        onClose();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const loadCart = async () => {
    try {
      setLoading(true);
      const response = await getCart();
      setCartItems(response.data || []);
    } catch (err) {
      setCartItems([]);
    } finally {
      setLoading(false);
    }
  };

  const subtotal = cartItems.reduce((sum, item) => {
    return sum + Number(item.product?.price || 0) * item.quantity;
  }, 0);

  if (!isOpen) return null;

  return (
    <>
      {/* Cart Preview - Small bottom center notification */}
      <div
        className={`fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-sm bg-white rounded-lg shadow-2xl border border-gray-200 transition-all duration-300 ease-out ${
          isOpen ? "translate-y-0 opacity-100" : "translate-y-full opacity-0 pointer-events-none"
        }`}
      >
        {/* Compact Cart Preview */}
        <div className="p-4">
          {loading ? (
            <div className="text-center text-gray-500 py-2">Loading...</div>
          ) : cartItems.length === 0 ? (
            <div className="text-center text-gray-500 py-2">
              <p className="text-sm">Your cart is empty</p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className="flex -space-x-2">
                  {cartItems.slice(0, 3).map((item, idx) => (
                    item.product?.image && (
                      <img
                        key={item.id}
                        src={item.product.image}
                        alt={item.product.name}
                        className="w-10 h-10 object-contain rounded-lg bg-gray-100 border-2 border-white"
                        style={{ zIndex: 10 - idx }}
                      />
                    )
                  ))}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {cartItems.length} {cartItems.length === 1 ? 'item' : 'items'} in cart
                  </p>
                  <p className="text-lg font-bold text-blue-600">
                    ${subtotal.toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="p-1.5 hover:bg-gray-100 rounded-full transition-colors"
                  aria-label="Close"
                >
                  <svg
                    className="w-4 h-4 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
                <Link href="/cart" onClick={onClose}>
                  <button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors text-sm whitespace-nowrap">
                    View Cart
                  </button>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getCart, logout, getCurrentUser } from "@/src/lib/api";
import SearchBar from "@/src/components/SearchBar";

export default function Header() {
  const router = useRouter();
  const [cartCount, setCartCount] = useState(0);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [prevCartCount, setPrevCartCount] = useState(0);
  const [badgePulse, setBadgePulse] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    checkAuthStatus();
    loadCartCount();
    // Only refresh cart count when window gains focus (user returns to tab)
    const handleFocus = () => {
      loadCartCount();
    };
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const checkAuthStatus = async () => {
    try {
      const userData = await getCurrentUser();
      setUser(userData.user);
      setIsLoggedIn(true);
    } catch {
      setUser(null);
      setIsLoggedIn(false);
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
      setIsLoggedIn(false);
      setUser(null);
      setCartCount(0);
      router.push("/");
      router.refresh();
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  const loadCartCount = async () => {
    try {
      const response = await getCart();
      const items = response.data || [];
      const totalItems = items.reduce(
        (sum: number, item: any) => sum + item.quantity,
        0
      );
      setPrevCartCount(cartCount);
      setCartCount(totalItems);

      // Trigger pulse animation when count increases
      if (totalItems > cartCount) {
        setBadgePulse(true);
        setTimeout(() => setBadgePulse(false), 600);
      }
    } catch (error) {
      setCartCount(0);
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-gradient-to-r from-blue-900 to-purple-900 border-b border-blue-800/40 shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-950 to-purple-950 rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg hover:shadow-xl transition-shadow duration-200 border border-white/30">
              U
            </div>
            <h1 className="text-2xl font-bold text-white">UniShop</h1>
          </Link>

          {/* Search Bar - Desktop */}
          <div className="hidden md:flex flex-1 max-w-md mx-8">
            <SearchBar
              placeholder="Search products..."
              showSuggestions={true}
              className="w-full"
            />
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-6">
            <Link
              href="/"
              className="text-white/90 hover:text-white font-medium transition-colors duration-200"
            >
              Products
            </Link>
            {isLoggedIn && (
              <>
                <Link
                  href="/cart"
                  className="relative text-white/90 hover:text-white font-medium transition-colors duration-200 flex items-center gap-2"
                >
                  <svg
                    className="w-6 h-6"
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
                  <span>Cart</span>
                  {cartCount > 0 && (
                    <span
                      className={`absolute -top-2 -right-3 bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 transition-all duration-300 ${
                        badgePulse ? "animate-pulse scale-125" : "scale-100"
                      }`}
                    >
                      {cartCount > 99 ? "99+" : cartCount}
                    </span>
                  )}
                </Link>
                <Link
                  href="/orders"
                  className="text-white/90 hover:text-white font-medium transition-colors duration-200"
                >
                  Orders
                </Link>
                <Link
                  href="/privacy"
                  className="text-white/90 hover:text-white font-medium transition-colors duration-200"
                >
                  Privacy
                </Link>
                <span className="text-white/70 text-sm">
                  Welcome, {user?.name || user?.email}
                </span>
                <button
                  onClick={handleLogout}
                  className="text-white/90 hover:text-white font-medium transition-colors duration-200"
                >
                  Logout
                </button>
              </>
            )}
            {!isLoggedIn && (
              <>
                <Link
                  href="/login"
                  className="text-white/90 hover:text-white font-medium transition-colors duration-200"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  className="bg-white/10 hover:bg-white/20 text-white font-medium px-4 py-2 rounded-md transition-colors duration-200"
                >
                  Sign Up
                </Link>
              </>
            )}
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden p-2 rounded-md text-white/90 hover:bg-white/10 transition-colors duration-200"
            aria-label="Toggle menu"
          >
            <svg
              className="w-6 h-6 transition-transform duration-300"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              {isMenuOpen ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              )}
            </svg>
          </button>
        </div>

        {/* Mobile Menu */}
        <div
          className={`md:hidden border-t border-white/20 overflow-hidden transition-all duration-300 ease-in-out ${
            isMenuOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          {/* Search Bar - Mobile */}
          <div className="px-4 py-3">
            <SearchBar
              placeholder="Search products..."
              showSuggestions={false}
              className="w-full"
            />
          </div>

          <nav className="flex flex-col gap-4 py-4">
            <Link
              href="/"
              onClick={() => setIsMenuOpen(false)}
              className="text-white/90 hover:text-white font-medium px-2 py-2 transition-colors duration-200"
            >
              Products
            </Link>
            {isLoggedIn ? (
              <>
                <Link
                  href="/cart"
                  onClick={() => setIsMenuOpen(false)}
                  className="relative text-white/90 hover:text-white font-medium px-2 py-2 transition-colors duration-200 flex items-center gap-2"
                >
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
                  <span>Cart</span>
                  {cartCount > 0 && (
                    <span
                      className={`ml-auto bg-red-500 text-white text-xs font-bold rounded-full min-w-[20px] h-5 flex items-center justify-center px-1.5 ${
                        badgePulse ? "animate-pulse" : ""
                      }`}
                    >
                      {cartCount > 99 ? "99+" : cartCount}
                    </span>
                  )}
                </Link>
                <Link
                  href="/orders"
                  onClick={() => setIsMenuOpen(false)}
                  className="text-white/90 hover:text-white font-medium px-2 py-2 transition-colors duration-200"
                >
                  Orders
                </Link>
                <div className="px-2 py-2 text-white/70 text-sm border-t border-white/20 pt-4">
                  Logged in as: {user?.name || user?.email}
                </div>
                <button
                  onClick={() => {
                    handleLogout();
                    setIsMenuOpen(false);
                  }}
                  className="text-white/90 hover:text-white font-medium px-2 py-2 transition-colors duration-200 text-left"
                >
                  Logout
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/login"
                  onClick={() => setIsMenuOpen(false)}
                  className="text-white/90 hover:text-white font-medium px-2 py-2 transition-colors duration-200"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  onClick={() => setIsMenuOpen(false)}
                  className="bg-white/10 hover:bg-white/20 text-white font-medium px-4 py-2 mx-2 rounded-md transition-colors duration-200 text-center"
                >
                  Sign Up
                </Link>
              </>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}

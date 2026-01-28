import { getUserId } from "./user";
import type {
  ApiResponse,
  Product,
  Pagination,
  CartItem,
  CartResponse,
  Recommendation,
  Order,
  AdminStats,
  CheckoutResponse,
  DiscountEligibilityResponse,
  DiscountPreviewResponse,
} from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export interface ProductsResponse {
  products: Product[];
  pagination: Pagination;
}

export async function fetchProducts(page: number = 1, limit: number = 10): Promise<ProductsResponse> {
  const response = await fetch(`${API_URL}/api/products?page=${page}&limit=${limit}`);

  if (!response.ok) {
    throw new Error("Failed to fetch products");
  }

  const result: ApiResponse<Product[]> = await response.json();
  if (!result.success || !result.data) {
    throw new Error("Failed to fetch products");
  }

  return {
    products: result.data,
    pagination: result.pagination || {
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: false,
    },
  };
}

export async function addToCart(productId: string, quantity: number = 1): Promise<ApiResponse<void>> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/cart`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      productId,
      quantity,
      customerId: userId,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to add to cart");
  }

  return response.json();
}

export async function getCart(): Promise<CartResponse> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/cart?customerId=${userId}`);

  if (!response.ok) {
    throw new Error("Failed to get cart");
  }

  const result: CartResponse = await response.json();
  return result;
}

export async function updateCartItem(cartItemId: string, quantity: number): Promise<ApiResponse<void>> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/cart/${cartItemId}?customerId=${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ quantity }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to update cart item");
  }

  return response.json();
}

export async function removeCartItem(cartItemId: string): Promise<ApiResponse<void>> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/cart/${cartItemId}?customerId=${userId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to remove cart item");
  }

  return response.json();
}

export async function fetchProductById(id: string): Promise<Product> {
  const response = await fetch(`${API_URL}/api/products/${id}`);

  if (!response.ok) {
    throw new Error("Failed to fetch product");
  }

  const result: ApiResponse<Product> = await response.json();
  if (!result.success || !result.data) {
    throw new Error("Product not found");
  }
  return result.data;
}

export async function fetchSimilarProducts(categoryId: string, excludeProductId: string, limit: number = 4): Promise<Product[]> {
  // Fetch products from same category, excluding current product
  const response = await fetch(`${API_URL}/api/products?page=1&limit=100`);

  if (!response.ok) {
    throw new Error("Failed to fetch similar products");
  }

  const result: ApiResponse<Product[]> = await response.json();
  const products = result.data || [];

  // Filter by category and exclude current product
  const similar = products
    .filter((p) => (p.categoryId === categoryId || p.category?.id === categoryId) && p.id !== excludeProductId)
    .slice(0, limit);

  return similar;
}

export async function checkout(discountCode?: string): Promise<CheckoutResponse> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      discountCode,
      customerId: userId,
    }),
  });

  if (!response.ok) {
    throw new Error("Checkout failed");
  }

  return response.json();
}

export async function generateDiscountCode(): Promise<ApiResponse<{ id: string; code: string; discountPercentage: number; isUsed: boolean; isAvailable: boolean }>> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/admin/discounts/generate?customerId=${userId}`, {
    method: "POST",
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to generate discount code");
  }

  return response.json();
}

export async function getAdminStats(): Promise<ApiResponse<AdminStats>> {
  const response = await fetch(`${API_URL}/api/admin/stats`);

  if (!response.ok) {
    throw new Error("Failed to get stats");
  }

  return response.json();
}

export async function getAvailableDiscountCodes(): Promise<ApiResponse<DiscountCode[]>> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/discounts/available?customerId=${userId}`);

  if (!response.ok) {
    throw new Error("Failed to get discount codes");
  }

  return response.json();
}

export async function checkDiscountEligibility(): Promise<DiscountEligibilityResponse> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/discounts/eligible?customerId=${userId}`);

  if (!response.ok) {
    throw new Error("Failed to check discount eligibility");
  }

  return response.json();
}

export async function previewDiscount(discountCode: string, subtotal: number): Promise<DiscountPreviewResponse> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/cart/preview-discount`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      discountCode,
      customerId: userId,
      subtotal,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to preview discount");
  }

  return response.json();
}

export async function getOrders(): Promise<ApiResponse<Order[]>> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/orders?customerId=${userId}`);

  if (!response.ok) {
    throw new Error("Failed to get orders");
  }

  return response.json();
}

export async function getOrderById(orderId: string): Promise<ApiResponse<Order>> {
  const response = await fetch(`${API_URL}/api/orders/${orderId}`);

  if (!response.ok) {
    throw new Error("Failed to get order");
  }

  return response.json();
}

export async function fetchRecommendations(productId: string): Promise<Recommendation[]> {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/recommendations?customerId=${userId}&productId=${productId}`);

  if (!response.ok) {
    throw new Error("Failed to fetch recommendations");
  }

  const result: ApiResponse<Recommendation[]> = await response.json();
  return result.data || [];
}

// Cart persistence API functions
export interface CartSessionData {
  items: any[];
  lastActivity: Date;
  itemCount: number;
  totalValue: number;
}

export async function updateCartSession(customerId: string, cartItems: any[]): Promise<void> {
  const response = await fetch(`${API_URL}/api/cart/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customerId, cartItems })
  });

  if (!response.ok) {
    throw new Error('Failed to update cart session');
  }
}

export async function getCartSession(customerId: string): Promise<CartSessionData | null> {
  const response = await fetch(`${API_URL}/api/cart/session/${customerId}`);

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error('Failed to get cart session');
  }

  const result: ApiResponse<CartSessionData> = await response.json();
  return result.data || null;
}

export async function recoverCart(recoveryToken: string, customerId?: string): Promise<any[]> {
  const response = await fetch(`${API_URL}/api/cart/recover/${recoveryToken}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ customerId })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to recover cart');
  }

  const result: ApiResponse<{ items: any[]; count: number }> = await response.json();
  return result.data?.items || [];
}

// Payment API functions
export interface InitiatePaymentData {
  orderId: string;
  amount: number;
  currency?: string;
  customerId: string;
  idempotencyKey: string;
  paymentMethod?: string;
}

export interface PaymentResult {
  status: string;
  gatewayId?: string;
  transactionId?: string;
}

export async function initiatePayment(data: InitiatePaymentData): Promise<PaymentResult> {
  const response = await fetch(`${API_URL}/api/payments/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Payment initiation failed');
  }

  const result: ApiResponse<PaymentResult> = await response.json();
  return result.data!;
}

export async function retryPayment(orderId: string, idempotencyKey: string): Promise<PaymentResult> {
  const response = await fetch(`${API_URL}/api/payments/retry/${orderId}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ idempotencyKey })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Payment retry failed');
  }

  const result: ApiResponse<PaymentResult> = await response.json();
  return result.data!;
}

export interface PaymentStatus {
  orderId: string;
  paymentStatus: string;
  paymentGatewayId?: string;
  attempts: number;
  lastAttempt?: string;
  createdAt: string;
  updatedAt: string;
}

export async function getPaymentStatus(orderId: string): Promise<PaymentStatus> {
  const response = await fetch(`${API_URL}/api/payments/status/${orderId}`);

  if (!response.ok) {
    throw new Error('Failed to get payment status');
  }

  const result: ApiResponse<PaymentStatus> = await response.json();
  return result.data!;
}

export interface RefundData {
  orderId: string;
  amount: number;
  reason?: string;
}

export interface RefundResult {
  refundId: string;
  status: string;
}

export async function initiateRefund(data: RefundData): Promise<RefundResult> {
  const response = await fetch(`${API_URL}/api/payments/refund`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Refund initiation failed');
  }

  const result: ApiResponse<RefundResult> = await response.json();
  return result.data!;
}

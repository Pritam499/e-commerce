import { getUserId } from "./user";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

export async function fetchProducts(page: number = 1, limit: number = 10) {
  const response = await fetch(`${API_URL}/api/products?page=${page}&limit=${limit}`);

  if (!response.ok) {
    throw new Error("Failed to fetch products");
  }

  const result = await response.json();
  return {
    products: result.data || [],
    pagination: result.pagination || {},
  };
}

export async function addToCart(productId: number, quantity: number = 1) {
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

export async function getCart() {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/cart?customerId=${userId}`);

  if (!response.ok) {
    throw new Error("Failed to get cart");
  }

  return response.json();
}

export async function updateCartItem(cartItemId: number, quantity: number) {
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

export async function removeCartItem(cartItemId: number) {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/cart/${cartItemId}?customerId=${userId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to remove cart item");
  }

  return response.json();
}

export async function fetchProductById(id: number) {
  const response = await fetch(`${API_URL}/api/products/${id}`);

  if (!response.ok) {
    throw new Error("Failed to fetch product");
  }

  const result = await response.json();
  return result.data;
}

export async function fetchSimilarProducts(categoryId: number, excludeProductId: number, limit: number = 4) {
  // Fetch products from same category, excluding current product
  const response = await fetch(`${API_URL}/api/products?page=1&limit=100`);
  
  if (!response.ok) {
    throw new Error("Failed to fetch similar products");
  }

  const result = await response.json();
  const products = result.data || [];
  
  // Filter by category and exclude current product
  const similar = products
    .filter((p: any) => (p.categoryId === categoryId || p.category?.id === categoryId) && p.id !== excludeProductId)
    .slice(0, limit);
  
  return similar;
}

export async function checkout(discountCode?: string) {
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

export async function generateDiscountCode() {
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

export async function getAdminStats() {
  const response = await fetch(`${API_URL}/api/admin/stats`);

  if (!response.ok) {
    throw new Error("Failed to get stats");
  }

  return response.json();
}

export async function getAvailableDiscountCodes() {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/discounts/available?customerId=${userId}`);

  if (!response.ok) {
    throw new Error("Failed to get discount codes");
  }

  return response.json();
}

export async function checkDiscountEligibility() {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/discounts/eligible?customerId=${userId}`);

  if (!response.ok) {
    throw new Error("Failed to check discount eligibility");
  }

  return response.json();
}

export async function previewDiscount(discountCode: string, subtotal: number) {
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

export async function getOrders() {
  const userId = getUserId();
  const response = await fetch(`${API_URL}/api/orders?customerId=${userId}`);

  if (!response.ok) {
    throw new Error("Failed to get orders");
  }

  return response.json();
}

export async function getOrderById(orderId: number) {
  const response = await fetch(`${API_URL}/api/orders/${orderId}`);

  if (!response.ok) {
    throw new Error("Failed to get order");
  }

  return response.json();
}

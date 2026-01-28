const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// Helper to get auth headers
function getAuthHeaders() {
  const token = localStorage.getItem("accessToken");
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

// Auth functions
export async function register(email: string, password: string, name: string) {
  const response = await fetch(`${API_URL}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password, name }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Registration failed");
  }

  const data = await response.json();
  localStorage.setItem("accessToken", data.accessToken);
  return data;
}

export async function login(email: string, password: string) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Login failed");
  }

  const data = await response.json();
  localStorage.setItem("accessToken", data.accessToken);
  return data;
}

export async function logout() {
  const response = await fetch(`${API_URL}/auth/logout`, {
    method: "POST",
    credentials: "include",
  });

  localStorage.removeItem("accessToken");
  return response.json();
}

export async function refreshToken() {
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Token refresh failed");
  }

  const data = await response.json();
  localStorage.setItem("accessToken", data.accessToken);
  return data;
}

export async function getCurrentUser() {
  const response = await fetch(`${API_URL}/auth/me`, {
    headers: getAuthHeaders(),
  });

  if (!response.ok) {
    throw new Error("Failed to get user");
  }

  return response.json();
}

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

export async function addToCart(productId: string, quantity: number = 1) {
  const response = await fetch(`${API_URL}/api/cart`, {
    method: "POST",
    headers: getAuthHeaders(),
    credentials: "include",
    body: JSON.stringify({
      productId,
      quantity,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to add to cart");
  }

  return response.json();
}

export async function getCart() {
  const response = await fetch(`${API_URL}/api/cart`, {
    headers: getAuthHeaders(),
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to get cart");
  }

  return response.json();
}

export async function updateCartItem(cartItemId: string, quantity: number) {
  const response = await fetch(`${API_URL}/api/cart/${cartItemId}`, {
    method: "PUT",
    headers: getAuthHeaders(),
    credentials: "include",
    body: JSON.stringify({ quantity }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || "Failed to update cart item");
  }

  return response.json();
}

export async function removeCartItem(cartItemId: string) {
  const response = await fetch(`${API_URL}/api/cart/${cartItemId}`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to remove cart item");
  }

  return response.json();
}

export async function fetchProductById(id: string) {
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
  const response = await fetch(`${API_URL}/api/checkout`, {
    method: "POST",
    headers: getAuthHeaders(),
    credentials: "include",
    body: JSON.stringify({
      discountCode: discountCode || undefined,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Checkout failed");
  }

  return response.json();
}

export async function generateDiscountCode(customerId?: string) {
  const response = await fetch(`${API_URL}/api/admin/discounts/generate`, {
    method: "POST",
    headers: getAuthHeaders(),
    credentials: "include",
    body: JSON.stringify({ customerId }),
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
  const response = await fetch(`${API_URL}/api/orders`, {
    headers: getAuthHeaders(),
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to get orders");
  }

  return response.json();
}

export async function getOrderById(orderId: string) {
  const response = await fetch(`${API_URL}/api/orders/${orderId}`, {
    headers: getAuthHeaders(),
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to get order");
  }

  return response.json();
}

// GDPR compliance endpoints
export async function requestDataExport() {
  const response = await fetch(`${API_URL}/api/gdpr/export`, {
    method: "GET",
    headers: getAuthHeaders(),
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to request data export");
  }

  return response.json();
}

export async function requestDataDeletion() {
  const response = await fetch(`${API_URL}/api/gdpr/delete`, {
    method: "DELETE",
    headers: getAuthHeaders(),
    credentials: "include",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Failed to request data deletion");
  }

  return response.json();
}

// Search functions
export async function searchProducts(params: {
  q?: string;
  category?: string;
  brand?: string;
  priceMin?: number;
  priceMax?: number;
  inStock?: boolean;
  tags?: string[];
  page?: number;
  limit?: number;
  sortBy?: string;
}) {
  const searchParams = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        searchParams.set(key, value.join(','));
      } else {
        searchParams.set(key, value.toString());
      }
    }
  });

  const response = await fetch(`${API_URL}/api/search?${searchParams.toString()}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Search failed');
  }

  return response.json();
}

export async function searchAutoComplete(query: string, limit = 10) {
  const response = await fetch(`${API_URL}/api/search/autocomplete?q=${encodeURIComponent(query)}&limit=${limit}`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Auto-complete failed');
  }

  return response.json();
}

export async function getSearchSuggestions() {
  const response = await fetch(`${API_URL}/api/search/suggestions`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to get suggestions');
  }

  return response.json();
}

// Image upload functions
export async function uploadImages(files: FileList | File[]): Promise<any> {
  const formData = new FormData();

  Array.from(files).forEach((file, index) => {
    formData.append('images', file);
  });

  const response = await fetch(`${API_URL}/api/images/upload/multiple`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

export async function uploadSingleImage(file: File): Promise<any> {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_URL}/api/images/upload`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

export async function uploadProductImages(productId: string, files: FileList | File[]): Promise<any> {
  const formData = new FormData();

  Array.from(files).forEach((file, index) => {
    formData.append('images', file);
  });

  const response = await fetch(`${API_URL}/api/products/${productId}/images`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Upload failed');
  }

  return response.json();
}

export async function getProductImages(productId: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/products/${productId}/images`);

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Failed to get images');
  }

  return response.json();
}

export async function deleteProductImage(productId: string, imageKey: string): Promise<any> {
  const response = await fetch(`${API_URL}/api/products/${productId}/images/${imageKey}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Delete failed');
  }

  return response.json();
}

export async function optimizeImage(imageUrl: string, options?: {
  width?: number;
  height?: number;
  quality?: number;
  format?: 'webp' | 'jpeg' | 'png' | 'avif';
}): Promise<any> {
  const params = new URLSearchParams();
  if (options?.width) params.set('width', options.width.toString());
  if (options?.height) params.set('height', options.height.toString());
  if (options?.quality) params.set('quality', options.quality.toString());
  if (options?.format) params.set('format', options.format);

  const response = await fetch(`${API_URL}/api/images/optimize?${params.toString()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageUrl }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Optimization failed');
  }

  return response.json();
}

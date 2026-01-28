// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  pagination?: Pagination;
}

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

// Product Types
export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  price: string;
  stock: number;
  image?: string;
  rating: string;
  createdAt: string;
  updatedAt: string;
  category?: Category;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
}

// Cart Types
export interface CartItem {
  id: string;
  customerId: string;
  productId: string;
  quantity: number;
  createdAt: string;
  updatedAt: string;
  product?: Product;
}

export interface CartResponse {
  data?: CartItem[];
}

// Recommendation Types
export interface Recommendation {
  id: string;
  name: string;
  price: string;
  rating: string;
  image?: string;
  category: {
    name: string;
  };
}

// Order Types
export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  price: string;
  createdAt: string;
  updatedAt: string;
  product?: Product;
}

export interface Order {
  id: string;
  customerId: string;
  discountCodeId?: string;
  subtotal: string;
  discountAmount: string;
  total: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  orderItems?: OrderItem[];
  discountCode?: DiscountCode;
  orderNumber?: number;
}

export interface DiscountCode {
  id: string;
  code: string;
  discountPercentage: number;
  isUsed: boolean;
  isAvailable: boolean;
  customerId?: string;
  orderNumberGenerated?: number;
  createdAt: string;
  updatedAt: string;
}

// Admin Stats Types
export interface AdminStats {
  totalItemsPurchased: number;
  totalPurchaseAmount: string;
  discountCodes: DiscountCode[];
  totalDiscountAmount: string;
}

// Checkout Types
export interface CheckoutRequest {
  customerId: string;
  discountCode?: string;
}

export interface CheckoutResponse {
  success: boolean;
  data?: Order;
  error?: string;
}

// Discount Types
export interface DiscountEligibilityResponse {
  eligible: boolean;
  reason?: string;
}

export interface DiscountPreviewResponse {
  discountAmount: string;
  finalTotal: string;
  discountCode?: string;
}
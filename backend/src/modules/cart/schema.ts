import { z } from "zod";

// CUID2 validation pattern (starts with c, followed by lowercase letters/numbers)
const cuidPattern = /^c[a-z0-9]+$/;

export const addToCartSchema = z.object({
  productId: z.string()
    .regex(cuidPattern, "Invalid product ID format")
    .min(1, "Product ID is required"),
  quantity: z.number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than 0")
    .max(999, "Quantity cannot exceed 999")
    .default(1),
  // customerId is now handled internally from JWT
});

export const updateCartItemSchema = z.object({
  cartItemId: z.string()
    .regex(cuidPattern, "Invalid cart item ID format")
    .min(1, "Cart item ID is required"),
  quantity: z.number()
    .int("Quantity must be a whole number")
    .min(0, "Quantity cannot be negative")
    .max(999, "Quantity cannot exceed 999"),
});

export const removeCartItemSchema = z.object({
  cartItemId: z.string()
    .regex(cuidPattern, "Invalid cart item ID format")
    .min(1, "Cart item ID is required"),
});

export const cartItemIdParamsSchema = z.object({
  cartItemId: z.string()
    .regex(cuidPattern, "Invalid cart item ID format")
    .min(1, "Cart item ID is required"),
});

export const previewDiscountSchema = z.object({
  discountCode: z.string()
    .min(1, "Discount code is required")
    .max(50, "Discount code too long")
    .regex(/^[A-Z0-9]+$/, "Discount code must be uppercase letters and numbers"),
  subtotal: z.number()
    .positive("Subtotal must be positive")
    .max(999999.99, "Subtotal too large"),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type RemoveCartItemInput = z.infer<typeof removeCartItemSchema>;
export type PreviewDiscountInput = z.infer<typeof previewDiscountSchema>;
export type CartItemIdParams = z.infer<typeof cartItemIdParamsSchema>;
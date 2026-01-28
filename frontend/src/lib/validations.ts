import { z } from "zod";

// Auth validations
export const registerSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address")
    .max(255, "Email too long"),
  password: z
    .string()
    .min(6, "Password must be at least 6 characters")
    .max(100, "Password too long")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
  name: z
    .string()
    .min(2, "Name must be at least 2 characters")
    .max(255, "Name too long")
    .regex(/^[a-zA-Z\s]+$/, "Name can only contain letters and spaces"),
});

export const loginSchema = z.object({
  email: z
    .string()
    .min(1, "Email is required")
    .email("Please enter a valid email address"),
  password: z
    .string()
    .min(1, "Password is required"),
});

export const changePasswordSchema = z.object({
  oldPassword: z
    .string()
    .min(1, "Current password is required"),
  newPassword: z
    .string()
    .min(6, "New password must be at least 6 characters")
    .max(100, "Password too long")
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      "Password must contain at least one uppercase letter, one lowercase letter, and one number"
    ),
  confirmPassword: z
    .string()
    .min(1, "Please confirm your password"),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

// Cart validations
export const addToCartSchema = z.object({
  productId: z
    .string()
    .regex(/^c[a-z0-9]+$/, "Invalid product ID"),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .positive("Quantity must be greater than 0")
    .max(999, "Quantity cannot exceed 999"),
});

export const updateCartSchema = z.object({
  cartItemId: z
    .string()
    .regex(/^c[a-z0-9]+$/, "Invalid cart item ID"),
  quantity: z
    .number()
    .int("Quantity must be a whole number")
    .min(0, "Quantity cannot be negative")
    .max(999, "Quantity cannot exceed 999"),
});

// Checkout validations
export const checkoutSchema = z.object({
  discountCode: z
    .string()
    .max(50, "Discount code too long")
    .regex(/^[A-Z0-9]*$/, "Discount code must be uppercase letters and numbers")
    .optional()
    .or(z.literal("")),
});

// Product validations
export const productQuerySchema = z.object({
  page: z
    .number()
    .int()
    .positive()
    .optional()
    .default(1),
  limit: z
    .number()
    .int()
    .positive()
    .max(100)
    .optional()
    .default(10),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type UpdateCartInput = z.infer<typeof updateCartSchema>;
export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type ProductQueryInput = z.infer<typeof productQuerySchema>;
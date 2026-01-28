import { z } from "zod";

// CUID2 validation pattern
const cuidPattern = /^c[a-z0-9]+$/;

export const checkoutSchema = z.object({
  discountCode: z.string()
    .max(50, "Discount code too long")
    .regex(/^[A-Z0-9]+$/, "Discount code must be uppercase letters and numbers")
    .optional(),
  // customerId is now handled internally from JWT
});

export const orderIdParamsSchema = z.object({
  id: z.string()
    .regex(cuidPattern, "Invalid order ID format")
    .min(1, "Order ID is required"),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type OrderIdParams = z.infer<typeof orderIdParamsSchema>;

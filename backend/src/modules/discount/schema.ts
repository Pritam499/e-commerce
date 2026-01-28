import { z } from "zod";

// CUID2 validation pattern
const cuidPattern = /^c[a-z0-9]+$/;

export const generateDiscountSchema = z.object({
  customerId: z.string()
    .regex(cuidPattern, "Invalid customer ID format")
    .optional(),
});

export const discountCodeParamsSchema = z.object({
  code: z.string()
    .min(1, "Discount code is required")
    .max(50, "Discount code too long")
    .regex(/^[A-Z0-9]+$/, "Discount code must be uppercase letters and numbers"),
});

export type GenerateDiscountInput = z.infer<typeof generateDiscountSchema>;
export type DiscountCodeParams = z.infer<typeof discountCodeParamsSchema>;
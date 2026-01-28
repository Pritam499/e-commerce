import { z } from "zod";

// CUID2 validation pattern
const cuidPattern = /^c[a-z0-9]+$/;

export const productsQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive("Page must be greater than 0")
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .positive("Limit must be greater than 0")
    .max(100, "Limit cannot exceed 100")
    .default(10),
});

export const productIdParamsSchema = z.object({
  id: z.string()
    .regex(cuidPattern, "Invalid product ID format")
    .min(1, "Product ID is required"),
});

export const categoryQuerySchema = z.object({
  page: z.coerce
    .number()
    .int()
    .positive("Page must be greater than 0")
    .default(1),
  limit: z.coerce
    .number()
    .int()
    .positive("Limit must be greater than 0")
    .max(100, "Limit cannot exceed 100")
    .default(10),
});

export type ProductsQuery = z.infer<typeof productsQuerySchema>;
export type ProductIdParams = z.infer<typeof productIdParamsSchema>;
export type CategoryQuery = z.infer<typeof categoryQuerySchema>;
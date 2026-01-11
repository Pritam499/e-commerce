import { z } from "zod";

export const addToCartSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().positive().default(1),
  customerId: z.string().uuid(),
});

export const updateCartItemSchema = z.object({
  cartItemId: z.string(),
  quantity: z.number().int().min(0),
});

export const removeCartItemSchema = z.object({
  cartItemId: z.string(),
});

export type AddToCartInput = z.infer<typeof addToCartSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type RemoveCartItemInput = z.infer<typeof removeCartItemSchema>;
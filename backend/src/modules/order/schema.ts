import { z } from "zod";

export const checkoutSchema = z.object({
  discountCode: z.string().optional(),
  customerId: z.string().uuid(),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

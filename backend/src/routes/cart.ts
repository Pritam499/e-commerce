import { FastifyInstance } from "fastify";
import { addToCart, getCartItems, updateCartItem, removeCartItem } from "../modules/cart/service";
import {
  addToCartSchema,
  updateCartItemSchema,
  removeCartItemSchema,
  cartItemIdParamsSchema,
  previewDiscountSchema,
  type AddToCartInput,
  type UpdateCartItemInput,
  type PreviewDiscountInput,
  type CartItemIdParams
} from "../modules/cart/schema";
import { previewDiscount } from "../modules/discount/service";
import { validateBody, validateParams } from "../lib/validation";

export async function cartRoutes(fastify: FastifyInstance) {
  // Add item to cart
  fastify.post<{ Body: AddToCartInput }>("/api/cart", {
    preHandler: [fastify.authenticate, validateBody(addToCartSchema)],
  }, async (request, reply) => {
    try {
      const result = await addToCart(request.body, request.user!.id);
      return reply.code(201).send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        error: error.message || "Failed to add item to cart",
      });
    }
  });

  // Get cart items
  fastify.get("/api/cart", {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const items = await getCartItems(request.user!.id);
      return reply.code(200).send({
        success: true,
        data: items,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get cart items",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  // Update cart item quantity
  fastify.put<{ Params: CartItemIdParams; Body: UpdateCartItemInput }>("/api/cart/:cartItemId", {
    preHandler: [fastify.authenticate, validateParams(cartItemIdParamsSchema), validateBody(updateCartItemSchema)],
  }, async (request, reply) => {
    try {
      const { cartItemId } = request.params;
      const { quantity } = request.body;
      const result = await updateCartItem(cartItemId, quantity, request.user!.id);
      return reply.code(200).send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        error: error.message || "Failed to update cart item",
      });
    }
  });

  // Remove cart item
  fastify.delete<{ Params: CartItemIdParams }>("/api/cart/:cartItemId", {
    preHandler: [fastify.authenticate, validateParams(cartItemIdParamsSchema)],
  }, async (request, reply) => {
    try {
      const { cartItemId } = request.params;
      const result = await removeCartItem(cartItemId, request.user!.id);
      return reply.code(200).send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        error: error.message || "Failed to remove cart item",
      });
    }
  });

  // Preview discount (calculate discount without applying)
  fastify.post<{ Body: PreviewDiscountInput }>("/api/cart/preview-discount", {
    preHandler: [fastify.authenticate, validateBody(previewDiscountSchema)],
  }, async (request, reply) => {
    try {
      const { discountCode, subtotal } = request.body;
      const preview = await previewDiscount(discountCode, request.user!.id, subtotal);

      return reply.code(200).send({
        success: preview.valid,
        data: preview,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        error: error.message || "Failed to preview discount",
      });
    }
  });
}

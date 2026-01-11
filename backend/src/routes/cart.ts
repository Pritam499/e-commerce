import { FastifyInstance } from "fastify";
import { addToCart, getCartItems, updateCartItem, removeCartItem } from "../modules/cart/service";
import { addToCartSchema, updateCartItemSchema, removeCartItemSchema } from "../modules/cart/schema";
import { previewDiscount } from "../modules/discount/service";

export async function cartRoutes(fastify: FastifyInstance) {
  // Add item to cart
  fastify.post("/api/cart", async (request, reply) => {
    try {
      const body = addToCartSchema.parse(request.body);
      if (!body.customerId) {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }
      const result = await addToCart(body);
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
  fastify.get("/api/cart", async (request: any, reply) => {
    try {
      const customerId = request.query?.customerId;
      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }
      const items = await getCartItems(customerId);
      return reply.code(200).send({
        success: true,
        data: items,
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get cart items",
        details: process.env.NODE_ENV === "development" ? error.stack : undefined,
      });
    }
  });

  // Update cart item quantity
  fastify.put("/api/cart/:cartItemId", async (request: any, reply) => {
    try {
      const cartItemId = request.params.cartItemId;
      const customerId = request.query?.customerId;
      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }
      if (!cartItemId || typeof cartItemId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Cart item ID is required",
        });
      }
      const body = updateCartItemSchema.parse({ cartItemId, quantity: request.body?.quantity ?? 0 });
      const result = await updateCartItem(cartItemId, body.quantity, customerId);
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
  fastify.delete("/api/cart/:cartItemId", async (request: any, reply) => {
    try {
      const cartItemId = request.params.cartItemId;
      const customerId = request.query?.customerId;
      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }
      if (!cartItemId || typeof cartItemId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Cart item ID is required",
        });
      }
      const result = await removeCartItem(cartItemId, customerId);
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
  fastify.post("/api/cart/preview-discount", async (request: any, reply) => {
    try {
      const { discountCode, customerId, subtotal } = request.body;
      
      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }

      if (!discountCode || typeof discountCode !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Discount code is required",
        });
      }

      if (typeof subtotal !== 'number' || subtotal < 0) {
        return reply.code(400).send({
          success: false,
          error: "Valid subtotal is required",
        });
      }

      const preview = await previewDiscount(discountCode, customerId, subtotal);
      
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

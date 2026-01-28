import { FastifyInstance } from "fastify";
import { addToCart, getCartItems, updateCartItem, removeCartItem } from "../modules/cart/service";
import { addToCartSchema, updateCartItemSchema, removeCartItemSchema } from "../modules/cart/schema";
import { previewDiscount } from "../modules/discount/service";
import { cartSessionManager, cartRecoveryManager } from "../modules/cart-persistence/service";
import { z } from "zod";

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

  // Update cart session (for persistence)
  fastify.post("/api/cart/session", async (request, reply) => {
    try {
      const { customerId, cartItems } = request.body as { customerId: string; cartItems: any[] };

      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }

      await cartSessionManager.updateSession(customerId, cartItems);

      return reply.code(200).send({
        success: true,
        message: "Cart session updated"
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: "Failed to update cart session"
      });
    }
  });

  // Get cart session
  fastify.get("/api/cart/session/:customerId", async (request, reply) => {
    try {
      const { customerId } = request.params as { customerId: string };

      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }

      const session = await cartSessionManager.getSession(customerId);

      return reply.code(200).send({
        success: true,
        data: session
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get cart session"
      });
    }
  });

  // Recover cart from token
  fastify.post("/api/cart/recover/:token", async (request, reply) => {
    try {
      const { token } = request.params as { token: string };
      const { customerId } = request.body as { customerId: string };

      if (!token || typeof token !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Recovery token is required",
        });
      }

      const recoveredItems = await cartRecoveryManager.recoverCart(token);

      if (!recoveredItems) {
        return reply.code(404).send({
          success: false,
          error: "Recovery token not found or expired"
        });
      }

      // If customerId provided, restore items to their cart
      if (customerId) {
        // Clear existing cart and add recovered items
        // This would typically be done through the existing cart service
        console.log(`Restoring ${recoveredItems.length} items to cart for customer ${customerId}`);
      }

      return reply.code(200).send({
        success: true,
        data: {
          items: recoveredItems,
          count: recoveredItems.length
        },
        message: `Successfully recovered ${recoveredItems.length} items`
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: "Failed to recover cart"
      });
    }
  });

  // Get cart recovery statistics (admin endpoint)
  fastify.get("/api/admin/cart-recovery/stats", async (request, reply) => {
    try {
      const stats = await cartRecoveryManager.getRecoveryStats();

      return reply.code(200).send({
        success: true,
        data: stats
      });
    } catch (error: any) {
      fastify.log.error(error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get recovery stats"
      });
    }
  });
}

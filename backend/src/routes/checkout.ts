import { FastifyInstance } from "fastify";
import { checkout, getAllOrders, getOrder, cancelOrder, returnOrderItems, updateOrderStatus } from "../modules/order/service";
import { checkoutSchema, orderIdParamsSchema, type CheckoutInput, type OrderIdParams } from "../modules/order/schema";
import { validateBody, validateParams } from "../lib/validation";

export async function checkoutRoutes(fastify: FastifyInstance) {
  // Checkout
  fastify.post<{ Body: CheckoutInput }>("/api/checkout", {
    preHandler: [fastify.authenticate, validateBody(checkoutSchema)],
  }, async (request, reply) => {
    try {
      const result = await checkout(request.body, request.user!.id);
      return reply.code(201).send({
        success: true,
        data: result,
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        error: error.message || "Checkout failed",
      });
    }
  });

  // Get all orders
  fastify.get("/api/orders", {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const orders = await getAllOrders(request.user!.id);
      return reply.code(200).send({
        success: true,
        data: orders,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get orders",
      });
    }
  });

  // Get order by ID
  fastify.get<{ Params: OrderIdParams }>("/api/orders/:id", {
    preHandler: [fastify.authenticate, validateParams(orderIdParamsSchema)],
  }, async (request, reply) => {
    try {
      const { id: orderId } = request.params;
      const order = await getOrder(orderId, request.user!.id); // Pass userId to ensure ownership
      if (!order) {
        return reply.code(404).send({
          success: false,
          error: "Order not found",
        });
      }
      return reply.code(200).send({
        success: true,
        data: order,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get order",
      });
    }
  });

  // Cancel order
  fastify.post<{ Params: OrderIdParams; Body: { reason?: string } }>("/api/orders/:id/cancel", {
    preHandler: [fastify.authenticate, validateParams(orderIdParamsSchema), validateBody(z.object({ reason: z.string().optional() }))],
  }, async (request, reply) => {
    try {
      const { id: orderId } = request.params;
      const { reason } = request.body;

      await cancelOrder(orderId, request.user!.id, reason);

      return reply.code(200).send({
        success: true,
        message: "Order cancelled successfully",
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        error: error.message || "Failed to cancel order",
      });
    }
  });

  // Return order items
  fastify.post<{ Params: OrderIdParams; Body: { returns: Array<{ productId: string; quantity: number; reason: string }> } }>("/api/orders/:id/return", {
    preHandler: [fastify.authenticate, validateParams(orderIdParamsSchema), validateBody(z.object({
      returns: z.array(z.object({
        productId: z.string().regex(/^c[a-z0-9]+$/, "Invalid product ID"),
        quantity: z.number().int().positive(),
        reason: z.string().min(1, "Return reason is required"),
      })).min(1, "At least one item must be returned"),
    }))],
  }, async (request, reply) => {
    try {
      const { id: orderId } = request.params;
      const { returns } = request.body;

      await returnOrderItems(orderId, request.user!.id, returns);

      return reply.code(200).send({
        success: true,
        message: "Items returned successfully",
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        error: error.message || "Failed to return items",
      });
    }
  });
}

// Import z for schema validation
import { z } from "zod";

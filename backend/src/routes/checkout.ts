import { FastifyInstance } from "fastify";
import { checkout, getAllOrders, getOrder } from "../modules/order/service";
import { checkoutSchema } from "../modules/order/schema";

export async function checkoutRoutes(fastify: FastifyInstance) {
  // Checkout
  fastify.post("/api/checkout", async (request, reply) => {
    try {
      const body = checkoutSchema.parse(request.body);
      if (!body.customerId) {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }
      const result = await checkout(body);
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
  fastify.get("/api/orders", async (request: any, reply) => {
    try {
      const customerId = request.query?.customerId;
      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }
      const orders = await getAllOrders(customerId);
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
  fastify.get("/api/orders/:id", async (request: any, reply) => {
    try {
      const orderId = request.params.id;
      if (!orderId || typeof orderId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Invalid order ID",
        });
      }
      const order = await getOrder(orderId);
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
}

import { FastifyInstance } from "fastify";
import { getAllOrders, getOrder } from "../modules/order/service";
import { checkoutSchema } from "../modules/order/schema";
import { emitEvent, createEvent } from "../modules/events/emitter";
import { EVENT_TYPES } from "../modules/events/types";
import { jobProducer } from "../modules/queue/producer";

export async function checkoutRoutes(fastify: FastifyInstance) {
  // Event-Driven Checkout - Emit event for processing
  fastify.post("/api/checkout", async (request, reply) => {
    try {
      const body = checkoutSchema.parse(request.body);
      if (!body.customerId) {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }

      // Generate correlation ID for tracking this request through the system
      const correlationId = `checkout_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Emit order checkout initiated event
      await emitEvent(createEvent(EVENT_TYPES.ORDER_CHECKOUT_INITIATED, {
        checkoutInput: body,
        userAgent: request.headers['user-agent'] as string,
        ipAddress: request.ip,
        sessionId: request.headers['x-session-id'] as string,
      }, {
        source: 'checkout-api',
        correlationId,
        userId: body.customerId,
        sessionId: request.headers['x-session-id'] as string,
        customMetadata: {
          ipAddress: request.ip,
          userAgent: request.headers['user-agent']
        }
      }));

      // Return immediate response - processing will happen asynchronously
      return reply.code(202).send({
        success: true,
        message: "Order processing initiated",
        data: {
          correlationId,
          status: 'initiated',
          estimatedProcessingTime: '2-5 seconds',
          trackingUrl: `/api/orders/tracking/${correlationId}`,
        },
      });
    } catch (error: any) {
      console.error('Failed to initiate checkout:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to initiate order processing",
      });
    }
  });

  // Get order tracking status by correlation ID
  fastify.get("/api/orders/tracking/:correlationId", async (request, reply) => {
    try {
      const { correlationId } = request.params as { correlationId: string };

      // In a real implementation, you'd have a tracking system that maps
      // correlation IDs to order/job status. For now, we'll return a mock response.

      // You could query the event history or a tracking table here
      const mockStatus = {
        correlationId,
        status: 'processing', // Could be: initiated, processing, completed, failed
        message: 'Order is being processed',
        progress: 50,
        estimatedCompletion: new Date(Date.now() + 30000).toISOString(), // 30 seconds from now
        events: [
          {
            type: 'order.checkout.initiated',
            timestamp: new Date(Date.now() - 5000).toISOString(),
            message: 'Order checkout initiated'
          },
          {
            type: 'job.enqueued',
            timestamp: new Date(Date.now() - 3000).toISOString(),
            message: 'Order processing job enqueued'
          }
        ]
      };

      return reply.code(200).send({
        success: true,
        data: mockStatus,
      });
    } catch (error: any) {
      console.error('Failed to get order tracking status:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get order tracking status",
      });
    }
  });

  // Legacy job status endpoint (for backward compatibility)
  fastify.get("/api/orders/status/:jobId", async (request, reply) => {
    try {
      const { jobId } = request.params as { jobId: string };

      // Check order processing job status
      const jobStatus = await jobProducer.getJobStatus('order-processing', jobId);

      if (!jobStatus) {
        return reply.code(404).send({
          success: false,
          error: "Job not found",
        });
      }

      // If job is completed, return the order data
      if (jobStatus.returnvalue && jobStatus.returnvalue.success) {
        return reply.code(200).send({
          success: true,
          status: 'completed',
          order: jobStatus.returnvalue.data,
        });
      }

      // If job failed, return error
      if (jobStatus.failedReason) {
        return reply.code(200).send({
          success: false,
          status: 'failed',
          error: jobStatus.failedReason,
        });
      }

      // Job is still processing
      return reply.code(200).send({
        success: true,
        status: 'processing',
        progress: jobStatus.progress || 0,
        attempts: jobStatus.attemptsMade,
        message: "Order is being processed",
      });
    } catch (error: any) {
      console.error('Failed to get job status:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get order status",
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

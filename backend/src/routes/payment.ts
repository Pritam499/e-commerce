import { FastifyInstance } from "fastify";
import { z } from "zod";
import { paymentService, PaymentProcessingError, WebhookVerificationError } from "../modules/payment/service";

// Payment initiation schema
const initiatePaymentSchema = z.object({
  orderId: z.string(),
  amount: z.number().positive(),
  currency: z.string().default("USD"),
  customerId: z.string(),
  idempotencyKey: z.string(),
  paymentMethod: z.string().optional(),
});

// Refund initiation schema
const initiateRefundSchema = z.object({
  orderId: z.string(),
  amount: z.number().positive(),
  reason: z.string().optional(),
});

export async function paymentRoutes(fastify: FastifyInstance) {
  // Initiate payment
  fastify.post("/api/payments/initiate", {
    schema: {
      body: initiatePaymentSchema,
    },
    handler: async (request, reply) => {
      try {
        const paymentData = request.body as z.infer<typeof initiatePaymentSchema>;

        const result = await paymentService.processPayment(paymentData);

        return reply.code(200).send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        if (error instanceof PaymentProcessingError) {
          return reply.code(400).send({
            success: false,
            error: error.message,
            code: 'PAYMENT_FAILED'
          });
        }

        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Payment processing failed",
        });
      }
    },
  });

  // Payment webhook handler
  fastify.post("/api/payments/webhook", {
    handler: async (request, reply) => {
      try {
        const rawBody = JSON.stringify(request.body);
        const signature = request.headers['x-webhook-signature'] as string ||
                         request.headers['stripe-signature'] as string ||
                         request.headers['razorpay-signature'] as string;

        if (!signature) {
          return reply.code(400).send({
            success: false,
            error: "Missing webhook signature"
          });
        }

        const result = await paymentService.handlePaymentWebhook(rawBody, signature, request.headers);

        return reply.code(200).send(result);
      } catch (error: any) {
        if (error instanceof WebhookVerificationError) {
          fastify.log.warn(`Webhook verification failed: ${error.message}`);
          return reply.code(401).send({
            success: false,
            error: "Invalid webhook signature"
          });
        }

        fastify.log.error(`Webhook processing failed: ${error.message}`);
        return reply.code(500).send({
          success: false,
          error: "Webhook processing failed"
        });
      }
    },
  });

  // Refund webhook handler
  fastify.post("/api/payments/refund-webhook", {
    handler: async (request, reply) => {
      try {
        const rawBody = JSON.stringify(request.body);
        const signature = request.headers['x-webhook-signature'] as string ||
                         request.headers['stripe-signature'] as string;

        if (!signature) {
          return reply.code(400).send({
            success: false,
            error: "Missing refund webhook signature"
          });
        }

        const result = await paymentService.handleRefundWebhook(rawBody, signature);

        return reply.code(200).send(result);
      } catch (error: any) {
        if (error instanceof WebhookVerificationError) {
          fastify.log.warn(`Refund webhook verification failed: ${error.message}`);
          return reply.code(401).send({
            success: false,
            error: "Invalid refund webhook signature"
          });
        }

        fastify.log.error(`Refund webhook processing failed: ${error.message}`);
        return reply.code(500).send({
          success: false,
          error: "Refund webhook processing failed"
        });
      }
    },
  });

  // Initiate refund
  fastify.post("/api/payments/refund", {
    schema: {
      body: initiateRefundSchema,
    },
    handler: async (request, reply) => {
      try {
        const refundData = request.body as z.infer<typeof initiateRefundSchema>;

        const result = await paymentService.initiateRefund(refundData);

        return reply.code(200).send({
          success: true,
          data: result,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({
          success: false,
          error: error.message || "Refund initiation failed",
        });
      }
    },
  });

  // Get payment status
  fastify.get("/api/payments/status/:orderId", {
    handler: async (request, reply) => {
      try {
        const { orderId } = request.params as { orderId: string };

        const order = await fastify.db.query.orders.findFirst({
          where: fastify.db.eq(fastify.db.orders.id, orderId),
          columns: {
            id: true,
            paymentStatus: true,
            paymentGatewayId: true,
            paymentAttempts: true,
            lastPaymentAttempt: true,
            createdAt: true,
            updatedAt: true
          }
        });

        if (!order) {
          return reply.code(404).send({
            success: false,
            error: "Order not found"
          });
        }

        return reply.code(200).send({
          success: true,
          data: {
            orderId: order.id,
            paymentStatus: order.paymentStatus,
            paymentGatewayId: order.paymentGatewayId,
            attempts: order.paymentAttempts,
            lastAttempt: order.lastPaymentAttempt,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt
          }
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(500).send({
          success: false,
          error: "Failed to get payment status"
        });
      }
    },
  });

  // Retry payment
  fastify.post("/api/payments/retry/:orderId", {
    handler: async (request, reply) => {
      try {
        const { orderId } = request.params as { orderId: string };
        const { idempotencyKey } = request.body as { idempotencyKey?: string };

        if (!idempotencyKey) {
          return reply.code(400).send({
            success: false,
            error: "Idempotency key required for retry"
          });
        }

        // Get order details
        const order = await fastify.db.query.orders.findFirst({
          where: fastify.db.eq(fastify.db.orders.id, orderId)
        });

        if (!order) {
          return reply.code(404).send({
            success: false,
            error: "Order not found"
          });
        }

        // Check if retry is allowed
        if (order.paymentStatus === 'completed') {
          return reply.code(400).send({
            success: false,
            error: "Payment already completed"
          });
        }

        if (order.paymentAttempts >= 3) {
          return reply.code(400).send({
            success: false,
            error: "Maximum retry attempts exceeded"
          });
        }

        // Retry payment
        const result = await paymentService.processPayment({
          orderId,
          amount: parseFloat(order.total),
          currency: 'USD', // Assuming USD, could be stored in order
          customerId: order.customerId,
          idempotencyKey
        });

        return reply.code(200).send({
          success: true,
          data: result
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.code(400).send({
          success: false,
          error: error.message || "Payment retry failed"
        });
      }
    },
  });
}
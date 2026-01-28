import { FastifyInstance } from "fastify";
import { eventBus, createEvent, emitEvent } from "../modules/events/emitter";
import { EVENT_TYPES } from "../modules/events/types";
import { webhookManager } from "../modules/events/webhooks";
import { logger } from "../utils/logger";
import { z } from "zod";

// Webhook registration schema
const webhookRegistrationSchema = z.object({
  url: z.string().url(),
  secret: z.string().min(16),
  events: z.array(z.nativeEnum(EVENT_TYPES)),
  retryAttempts: z.number().min(1).max(10).default(3),
  retryDelay: z.number().min(1000).default(5000),
  timeout: z.number().min(5000).max(60000).default(30000),
});

export async function eventRoutes(fastify: FastifyInstance) {
  // Register webhook endpoint
  fastify.post("/api/webhooks/register", async (request, reply) => {
    try {
      const webhookData = webhookRegistrationSchema.parse(request.body);

      const webhookId = webhookManager.registerWebhook({
        url: webhookData.url,
        secret: webhookData.secret,
        events: webhookData.events,
        retryAttempts: webhookData.retryAttempts,
        retryDelay: webhookData.retryDelay,
        timeout: webhookData.timeout,
      });

      return reply.code(201).send({
        success: true,
        data: {
          webhookId,
          message: "Webhook registered successfully"
        }
      });
    } catch (error: any) {
      console.error('Failed to register webhook:', error);
      return reply.code(400).send({
        success: false,
        error: error.message || "Failed to register webhook"
      });
    }
  });

  // Unregister webhook
  fastify.delete("/api/webhooks/:webhookId", async (request, reply) => {
    try {
      const { webhookId } = request.params as { webhookId: string };

      const success = webhookManager.unregisterWebhook(webhookId);

      if (!success) {
        return reply.code(404).send({
          success: false,
          error: "Webhook not found"
        });
      }

      return reply.code(200).send({
        success: true,
        message: "Webhook unregistered successfully"
      });
    } catch (error: any) {
      console.error('Failed to unregister webhook:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to unregister webhook"
      });
    }
  });

  // Get registered webhooks
  fastify.get("/api/webhooks", async (request, reply) => {
    try {
      const webhooks = webhookManager.getWebhooks();

      return reply.code(200).send({
        success: true,
        data: webhooks
      });
    } catch (error: any) {
      console.error('Failed to get webhooks:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get webhooks"
      });
    }
  });

  // Get webhook statistics
  fastify.get("/api/webhooks/stats", async (request, reply) => {
    try {
      const stats = webhookManager.getStats();

      return reply.code(200).send({
        success: true,
        data: stats
      });
    } catch (error: any) {
      console.error('Failed to get webhook stats:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get webhook statistics"
      });
    }
  });

  // Get event bus statistics
  fastify.get("/api/events/stats", async (request, reply) => {
    try {
      const eventStats = eventBus.getStats();
      const loggerStats = logger.getStats();

      return reply.code(200).send({
        success: true,
        data: {
          events: eventStats,
          logs: loggerStats
        }
      });
    } catch (error: any) {
      console.error('Failed to get event stats:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get event statistics"
      });
    }
  });

  // Get event history
  fastify.get("/api/events/history", async (request, reply) => {
    try {
      const limit = parseInt(request.query.limit as string) || 50;
      const eventHistory = eventBus.getEventHistory(limit);

      return reply.code(200).send({
        success: true,
        data: eventHistory
      });
    } catch (error: any) {
      console.error('Failed to get event history:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get event history"
      });
    }
  });

  // Manually emit test event (for development/testing)
  fastify.post("/api/events/test", async (request, reply) => {
    try {
      const { eventType, data, userId, sessionId } = request.body as {
        eventType: EVENT_TYPES;
        data: any;
        userId?: string;
        sessionId?: string;
      };

      if (!eventType || !EVENT_TYPES[eventType]) {
        return reply.code(400).send({
          success: false,
          error: "Invalid event type"
        });
      }

      await emitEvent(createEvent(eventType, data || {}, {
        source: 'test-api',
        userId,
        sessionId
      }));

      return reply.code(200).send({
        success: true,
        message: `Test event ${eventType} emitted successfully`
      });
    } catch (error: any) {
      console.error('Failed to emit test event:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to emit test event"
      });
    }
  });

  // Webhook test endpoint (for development)
  fastify.post("/api/webhooks/test", async (request, reply) => {
    try {
      const rawBody = JSON.stringify(request.body);
      const signature = request.headers['x-webhook-signature'] as string || 'test-signature';

      // Create a mock webhook event for testing
      const testEvent = {
        id: `test_webhook_${Date.now()}`,
        event: EVENT_TYPES.ORDER_CREATED,
        created: new Date(),
        data: request.body,
      };

      // Test signature verification (skip in test mode)
      const isValidSignature = signature === 'test-signature' ||
        webhookManager.verifyWebhookSignature(rawBody, signature, 'test-secret');

      if (!isValidSignature) {
        return reply.code(401).send({
          success: false,
          error: "Invalid webhook signature"
        });
      }

      logger.info('✅ Test webhook received and verified', { testEvent });

      return reply.code(200).send({
        success: true,
        message: "Test webhook received successfully",
        verified: isValidSignature
      });
    } catch (error: any) {
      console.error('Test webhook failed:', error);
      return reply.code(500).send({
        success: false,
        error: "Test webhook processing failed"
      });
    }
  });

  // Order status webhook endpoint (for external systems)
  fastify.post("/api/webhooks/order-status", async (request, reply) => {
    try {
      // This endpoint can be used by external systems to receive order status updates
      // In a real implementation, this would validate the webhook and process the update

      const { orderId, status, customerId } = request.body;

      logger.info(`📡 Order status webhook received: ${orderId} → ${status}`, {
        customerId,
        timestamp: new Date().toISOString()
      });

      // Here you could update external systems, send notifications, etc.

      return reply.code(200).send({
        success: true,
        message: "Order status webhook processed"
      });
    } catch (error: any) {
      console.error('Order status webhook failed:', error);
      return reply.code(500).send({
        success: false,
        error: "Order status webhook processing failed"
      });
    }
  });

  // Worker status webhook endpoint
  fastify.post("/api/webhooks/worker-status", async (request, reply) => {
    try {
      const { workerId, queueName, jobId, jobType, status } = request.body;

      logger.info(`⚙️ Worker status webhook: ${workerId} (${queueName}) - ${jobId} → ${status}`);

      // Here you could update monitoring dashboards, send alerts, etc.

      return reply.code(200).send({
        success: true,
        message: "Worker status webhook processed"
      });
    } catch (error: any) {
      console.error('Worker status webhook failed:', error);
      return reply.code(500).send({
        success: false,
        error: "Worker status webhook processing failed"
      });
    }
  });
}
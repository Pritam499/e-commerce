import Fastify from "fastify";
import cors from "@fastify/cors";
import { cartRoutes } from "./routes/cart";
import { checkoutRoutes } from "./routes/checkout";
import { productRoutes } from "./routes/products";
import { adminDiscountRoutes } from "./routes/admin/discounts";
import { adminStatsRoutes } from "./routes/admin/stats";
import recommendationRoutes from "./routes/recommendations";
import { paymentRoutes } from "./routes/payment";
import { queueRoutes } from "./routes/queue";
import { eventRoutes } from "./routes/events";
import { paymentReconciler } from "./modules/payment/reconciler";
import { backgroundJobScheduler } from "./modules/scheduler/service";
import { queueWorker } from "./modules/queue/worker";
import { eventDrivenJobHandlers } from "./modules/queue/event-handlers";

export async function buildServer() {
  const fastify = Fastify({
    logger: true,
  });

  // Register CORS
  await fastify.register(cors, {
    origin: true,
  });

  // Register routes
  await fastify.register(productRoutes);
  await fastify.register(cartRoutes);
  await fastify.register(checkoutRoutes);
  await fastify.register(adminDiscountRoutes);
  await fastify.register(adminStatsRoutes);
  await fastify.register(recommendationRoutes);
  await fastify.register(paymentRoutes);
  await fastify.register(queueRoutes);
  await fastify.register(eventRoutes);

  // Start background jobs and queue workers
  paymentReconciler.startReconciliationJob();
  backgroundJobScheduler.start();
  // Queue workers are automatically started when imported

  // Cleanup on server close
  fastify.addHook('onClose', async () => {
    paymentReconciler.stopReconciliationJob();
    backgroundJobScheduler.stop();
  });

  return fastify;
}

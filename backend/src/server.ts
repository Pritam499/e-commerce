import Fastify from "fastify";
import cors from "@fastify/cors";
import { cartRoutes } from "./routes/cart";
import { checkoutRoutes } from "./routes/checkout";
import { productRoutes } from "./routes/products";
import { adminDiscountRoutes } from "./routes/admin/discounts";
import { adminStatsRoutes } from "./routes/admin/stats";

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

  return fastify;
}

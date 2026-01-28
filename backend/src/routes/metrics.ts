import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { monitoring } from "../lib/monitoring";

export async function metricsRoutes(fastify: FastifyInstance) {
  // Prometheus metrics endpoint
  fastify.get("/metrics", async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const metrics = await monitoring.getMetrics();

      reply.header('Content-Type', 'text/plain; charset=utf-8');
      return reply.send(metrics);
    } catch (error: any) {
      request.log.error('Metrics collection failed', { error: error.message });
      return reply.code(500).send('Error collecting metrics');
    }
  });
}
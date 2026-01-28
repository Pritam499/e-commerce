import { FastifyInstance } from "fastify";
import { getAdminStats } from "../../modules/admin/service";

export async function adminStatsRoutes(fastify: FastifyInstance) {
  // Get admin statistics
  fastify.get("/api/admin/stats", async (request, reply) => {
    try {
      const stats = await getAdminStats();
      return reply.code(200).send({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get statistics",
      });
    }
  });
}

import { FastifyInstance } from "fastify";
import { jobProducer } from "../modules/queue/producer";
import { queueWorker } from "../modules/queue/worker";

export async function queueRoutes(fastify: FastifyInstance) {
  // Get queue statistics
  fastify.get("/api/admin/queues/stats", async (request, reply) => {
    try {
      const queueStats = await jobProducer.getAllQueueStats();
      const workerStats = await queueWorker.getAllWorkerStats();

      return reply.code(200).send({
        success: true,
        data: {
          queues: queueStats,
          workers: workerStats,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      console.error('Failed to get queue stats:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get queue statistics",
      });
    }
  });

  // Get specific queue statistics
  fastify.get("/api/admin/queues/:queueName/stats", async (request, reply) => {
    try {
      const { queueName } = request.params as { queueName: string };

      const queueStats = await jobProducer.getQueueStats(queueName);
      const workerStats = await queueWorker.getWorkerStats(queueName);

      return reply.code(200).send({
        success: true,
        data: {
          queue: queueStats,
          worker: workerStats,
          queueName,
          timestamp: new Date().toISOString(),
        },
      });
    } catch (error: any) {
      console.error(`Failed to get stats for queue ${request.params.queueName}:`, error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get queue statistics",
      });
    }
  });

  // Get job details
  fastify.get("/api/admin/queues/job/:queueName/:jobId", async (request, reply) => {
    try {
      const { queueName, jobId } = request.params as { queueName: string; jobId: string };

      const jobStatus = await jobProducer.getJobStatus(queueName, jobId);

      if (!jobStatus) {
        return reply.code(404).send({
          success: false,
          error: "Job not found",
        });
      }

      return reply.code(200).send({
        success: true,
        data: jobStatus,
      });
    } catch (error: any) {
      console.error('Failed to get job details:', error);
      return reply.code(500).send({
        success: false,
        error: "Failed to get job details",
      });
    }
  });

  // Emergency queue cleanup (admin only)
  fastify.delete("/api/admin/queues/:queueName", async (request, reply) => {
    try {
      const { queueName } = request.params as { queueName: string };

      // In production, add authentication check here
      // if (!isAdmin(request)) return reply.code(403).send({ error: 'Unauthorized' });

      await jobProducer.emergencyCleanup(queueName);

      return reply.code(200).send({
        success: true,
        message: `Emergency cleanup completed for queue: ${queueName}`,
      });
    } catch (error: any) {
      console.error('Emergency cleanup failed:', error);
      return reply.code(500).send({
        success: false,
        error: "Emergency cleanup failed",
      });
    }
  });

  // Health check for queue system
  fastify.get("/api/health/queues", async (request, reply) => {
    try {
      const queueStats = await jobProducer.getAllQueueStats();
      const workerStats = await queueWorker.getAllWorkerStats();

      // Check if all queues and workers are operational
      const queuesHealthy = Object.values(queueStats).every(stats => stats !== null);
      const workersHealthy = Object.values(workerStats).every(stats => stats !== null);

      const isHealthy = queuesHealthy && workersHealthy;

      const response = {
        status: isHealthy ? 'healthy' : 'unhealthy',
        timestamp: new Date().toISOString(),
        queues: {
          count: Object.keys(queueStats).length,
          healthy: queuesHealthy,
          stats: queueStats,
        },
        workers: {
          count: Object.keys(workerStats).length,
          healthy: workersHealthy,
          stats: workerStats,
        },
      };

      return reply.code(isHealthy ? 200 : 503).send(response);
    } catch (error: any) {
      console.error('Queue health check failed:', error);
      return reply.code(503).send({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  });
}
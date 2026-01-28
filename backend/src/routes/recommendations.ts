import { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRecommendations } from "../modules/recommendation/service";

const recommendationSchema = z.object({
  customerId: z.string().uuid(),
  productId: z.string(),
});

export default async function recommendationRoutes(fastify: FastifyInstance) {
  // Get personalized recommendations for a product
  fastify.get("/api/recommendations", {
    schema: {
      querystring: recommendationSchema,
    },
    handler: async (request, reply) => {
      const { customerId, productId } = request.query as z.infer<typeof recommendationSchema>;

      try {
        const recommendations = await getRecommendations(customerId, productId, 5);

        return reply.send({
          success: true,
          data: recommendations,
        });
      } catch (error: any) {
        fastify.log.error(error);
        return reply.status(500).send({
          success: false,
          error: "Failed to get recommendations",
        });
      }
    },
  });
}
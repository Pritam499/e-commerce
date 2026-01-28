import { FastifyInstance } from "fastify";
import { generateDiscountCodeForCustomer, getAvailableDiscountCodes, isEligibleForNthOrderDiscount } from "../../modules/discount/service";
import { generateDiscountSchema, type GenerateDiscountInput } from "../../modules/discount/schema";
import { authorize } from "../../lib/auth";
import { validateBody } from "../../lib/validation";

export async function adminDiscountRoutes(fastify: FastifyInstance) {
  // Generate discount code for a customer (admin only)
  fastify.post<{ Body: GenerateDiscountInput }>("/api/admin/discounts/generate", {
    preHandler: [fastify.authenticate, authorize(["admin"]), validateBody(generateDiscountSchema)],
  }, async (request, reply) => {
    try {
      const { customerId } = request.body;
      const result = await generateDiscountCodeForCustomer(customerId || request.user!.id);
      return reply.code(200).send({
        success: true,
        data: {
          code: result.code,
          discountPercentage: result.discountPercentage,
          orderNumberGenerated: result.orderNumberGenerated,
        },
      });
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        error: error.message || "Failed to generate discount code",
      });
    }
  });

  // Get available discount codes for a customer (for cart/checkout)
  fastify.get("/api/discounts/available", {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const codes = await getAvailableDiscountCodes(request.user!.id);
      return reply.code(200).send({
        success: true,
        data: codes,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get discount codes",
      });
    }
  });

  // Check if customer is eligible for nth order discount
  fastify.get("/api/discounts/eligible", {
    preHandler: [fastify.authenticate],
  }, async (request, reply) => {
    try {
      const eligible = await isEligibleForNthOrderDiscount(request.user!.id);
      return reply.code(200).send({
        success: true,
        data: { eligible },
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to check eligibility",
      });
    }
  });
}

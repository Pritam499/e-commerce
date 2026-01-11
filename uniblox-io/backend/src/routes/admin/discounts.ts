import { FastifyInstance } from "fastify";
import { generateDiscountCodeForCustomer, getAvailableDiscountCodes, isEligibleForNthOrderDiscount } from "../../modules/discount/service";

export async function adminDiscountRoutes(fastify: FastifyInstance) {
  // Generate discount code for a customer
  fastify.post("/api/admin/discounts/generate", async (request: any, reply) => {
    try {
      const customerId = request.body?.customerId || request.query?.customerId;
      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }
      const result = await generateDiscountCodeForCustomer(customerId);
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
  fastify.get("/api/discounts/available", async (request: any, reply) => {
    try {
      const customerId = request.query?.customerId;
      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }
      const codes = await getAvailableDiscountCodes(customerId);
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
  fastify.get("/api/discounts/eligible", async (request: any, reply) => {
    try {
      const customerId = request.query?.customerId;
      if (!customerId || typeof customerId !== 'string') {
        return reply.code(400).send({
          success: false,
          error: "Customer ID is required",
        });
      }
      const eligible = await isEligibleForNthOrderDiscount(customerId);
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

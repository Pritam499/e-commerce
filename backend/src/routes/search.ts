import { FastifyInstance } from "fastify";
import { searchService, type SearchOptions, type AutoCompleteResult } from "../lib/search-service";
import { validateQuery } from "../lib/validation";
import { z } from "zod";

// Search query validation schema
const searchQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  brand: z.string().optional(),
  priceMin: z.coerce.number().optional(),
  priceMax: z.coerce.number().optional(),
  inStock: z.coerce.boolean().optional(),
  tags: z.string().optional().transform(val => val ? val.split(',') : undefined),
  page: z.coerce.number().positive().default(1),
  limit: z.coerce.number().positive().max(100).default(20),
  sortBy: z.enum(['relevance', 'price_asc', 'price_desc', 'newest', 'name']).default('relevance'),
  searchType: z.enum(['exact', 'fuzzy', 'prefix', 'contains']).optional(),
  fuzzyDistance: z.coerce.number().min(1).max(3).optional(),
});

// Auto-complete query schema
const autoCompleteQuerySchema = z.object({
  q: z.string().min(1, "Query is required"),
  limit: z.coerce.number().positive().max(20).default(10),
});

export async function searchRoutes(fastify: FastifyInstance) {
  // Main search endpoint
  fastify.get<{ Querystring: z.infer<typeof searchQuerySchema> }>("/api/search", {
    preHandler: [validateQuery(searchQuerySchema)],
  }, async (request, reply) => {
    try {
      const {
        q: query,
        category,
        brand,
        priceMin,
        priceMax,
        inStock,
        tags,
        page,
        limit,
        sortBy,
        searchType,
        fuzzyDistance,
      } = request.query;

      const filters = {
        category,
        brand,
        priceMin,
        priceMax,
        inStock,
        tags,
      };

      const options: SearchOptions = {
        query,
        filters,
        page,
        limit,
        sortBy,
        useFuzzy: searchType === 'fuzzy',
        fuzzyDistance,
      };

      let results;
      if (searchType && searchType !== 'exact') {
        // Use advanced search
        results = await searchService.advancedSearch({
          ...options,
          searchType,
        });
      } else {
        // Use regular search
        results = await searchService.search(options);
      }

      return reply.send({
        success: true,
        data: results,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Search failed",
      });
    }
  });

  // Auto-complete endpoint
  fastify.get<{ Querystring: z.infer<typeof autoCompleteQuerySchema> }>("/api/search/autocomplete", {
    preHandler: [validateQuery(autoCompleteQuerySchema)],
  }, async (request, reply) => {
    try {
      const { q: query, limit } = request.query;

      const results = await searchService.getAutoComplete(query, limit);

      return reply.send({
        success: true,
        data: results,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Auto-complete failed",
      });
    }
  });

  // Search suggestions endpoint (popular searches)
  fastify.get("/api/search/suggestions", async (request, reply) => {
    try {
      // Get popular searches from trie
      const popular = await searchService.getAutoComplete('', 10);

      return reply.send({
        success: true,
        data: {
          popular: popular.popular,
        },
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get suggestions",
      });
    }
  });

  // Search analytics/stats endpoint (admin only)
  fastify.get("/api/search/stats", {
    preHandler: [fastify.authenticate, async (req, reply) => {
      if (req.user?.role !== 'admin') {
        return reply.code(403).send({ error: 'Admin access required' });
      }
    }],
  }, async (request, reply) => {
    try {
      const stats = searchService.getStats();

      return reply.send({
        success: true,
        data: stats,
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to get search stats",
      });
    }
  });

  // Reindex products endpoint (admin only)
  fastify.post("/api/search/reindex", {
    preHandler: [fastify.authenticate, async (req, reply) => {
      if (req.user?.role !== 'admin') {
        return reply.code(403).send({ error: 'Admin access required' });
      }
    }],
  }, async (request, reply) => {
    try {
      await searchService.initialize();

      return reply.send({
        success: true,
        message: "Search indices rebuilt successfully",
      });
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        error: error.message || "Failed to reindex",
      });
    }
  });
}
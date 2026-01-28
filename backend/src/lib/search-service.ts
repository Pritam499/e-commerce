import { elasticsearchService, ProductDocument, SearchFilters, SearchResult } from './elasticsearch';
import { productNameTrie, categoryNameTrie, brandTrie, initializeTries } from './trie';
import { logger } from './logger';
import { db } from './db';
import { products } from '../drizzle/schema';
import { eq, sql } from 'drizzle-orm';

export interface SearchOptions {
  query?: string;
  filters?: SearchFilters;
  page?: number;
  limit?: number;
  sortBy?: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'name';
  useFuzzy?: boolean;
  fuzzyDistance?: number;
}

export interface AutoCompleteResult {
  suggestions: Array<{
    text: string;
    type: 'product' | 'category' | 'brand';
    productIds?: string[];
  }>;
  popular: Array<{ text: string; frequency: number }>;
}

export interface FacetedSearchResult extends SearchResult {
  appliedFilters: SearchFilters;
  availableFilters: {
    categories: Array<{ key: string; count: number }>;
    brands: Array<{ key: string; count: number }>;
    priceRanges: Array<{ key: string; min: number; max: number; count: number }>;
    tags: Array<{ key: string; count: number }>;
  };
}

export class SearchService {
  private cache = new Map<string, { result: any; timestamp: number }>();
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  // Initialize search indices
  async initialize(): Promise<void> {
    try {
      // Initialize Elasticsearch
      await elasticsearchService.initializeIndex();

      // Load all products for trie initialization
      const allProducts = await db.query.products.findMany({
        with: {
          category: true,
        },
      });

      // Transform to ProductDocument format
      const productDocs: ProductDocument[] = allProducts.map(product => ({
        id: product.id,
        name: product.name,
        description: product.description || undefined,
        price: parseFloat(product.price),
        stock: product.stock,
        image: product.image || undefined,
        categoryId: product.categoryId,
        categoryName: product.category?.name,
        brand: undefined, // Add brand field to schema if needed
        tags: [], // Add tags field to schema if needed
        createdAt: product.createdAt.toISOString(),
        updatedAt: product.updatedAt.toISOString(),
      }));

      // Index in Elasticsearch
      await elasticsearchService.bulkIndexProducts(productDocs);

      // Initialize tries
      await initializeTries(allProducts.map(p => ({
        id: p.id,
        name: p.name,
        category: p.category,
        brand: undefined,
      })));

      logger.info('Search service initialized', {
        productsIndexed: productDocs.length
      });
    } catch (error) {
      logger.error('Failed to initialize search service', error);
      throw error;
    }
  }

  // Main search function
  async search(options: SearchOptions): Promise<FacetedSearchResult> {
    const {
      query = '',
      filters = {},
      page = 1,
      limit = 20,
      sortBy = 'relevance',
      useFuzzy = false,
      fuzzyDistance = 2,
    } = options;

    const cacheKey = this.generateCacheKey(options);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTTL) {
      return cached.result;
    }

    try {
      let result: SearchResult;

      if (useFuzzy && query) {
        // Use fuzzy search
        result = await elasticsearchService.fuzzySearch(query, fuzzyDistance);
      } else {
        // Use regular search
        result = await elasticsearchService.searchProducts(query, filters, page, limit, sortBy);
      }

      const searchResult: FacetedSearchResult = {
        ...result,
        appliedFilters: filters,
        availableFilters: {
          categories: result.facets.categories,
          brands: result.facets.brands,
          priceRanges: result.facets.priceRanges,
          tags: result.facets.tags,
        },
      };

      // Cache result
      this.cache.set(cacheKey, { result: searchResult, timestamp: Date.now() });

      logger.debug('Search executed', {
        query,
        filters,
        page,
        limit,
        total: result.total,
        took: result.took,
      });

      return searchResult;
    } catch (error) {
      logger.error('Search failed', { options, error });

      // Return empty result on error
      return {
        products: [],
        total: 0,
        facets: { categories: [], brands: [], priceRanges: [], tags: [] },
        suggestions: [],
        took: 0,
        appliedFilters: filters,
        availableFilters: { categories: [], brands: [], priceRanges: [], tags: [] },
      };
    }
  }

  // Auto-complete suggestions
  async getAutoComplete(query: string, limit: number = 10): Promise<AutoCompleteResult> {
    if (!query || query.length < 2) {
      return {
        suggestions: [],
        popular: [],
      };
    }

    try {
      const suggestions: AutoCompleteResult['suggestions'] = [];

      // Get product name suggestions
      const productSuggestions = productNameTrie.getSuggestionsWithProducts(query);
      productSuggestions.forEach(suggestion => {
        suggestions.push({
          text: suggestion.word,
          type: 'product',
          productIds: suggestion.productIds,
        });
      });

      // Get category suggestions
      const categorySuggestions = categoryNameTrie.searchPrefix(query);
      categorySuggestions.forEach(suggestion => {
        suggestions.push({
          text: suggestion,
          type: 'category',
        });
      });

      // Get brand suggestions
      const brandSuggestions = brandTrie.searchPrefix(query);
      brandSuggestions.forEach(suggestion => {
        suggestions.push({
          text: suggestion,
          type: 'brand',
        });
      });

      // Get Elasticsearch suggestions
      const esSuggestions = await elasticsearchService.getSuggestions(query, 5);
      esSuggestions.forEach(suggestion => {
        if (!suggestions.some(s => s.text === suggestion)) {
          suggestions.push({
            text: suggestion,
            type: 'product',
          });
        }
      });

      // Remove duplicates and limit
      const uniqueSuggestions = suggestions
        .filter((suggestion, index, self) =>
          index === self.findIndex(s => s.text === suggestion.text)
        )
        .slice(0, limit);

      // Get popular searches
      const popular = productNameTrie.getPopularSearches(5);

      return {
        suggestions: uniqueSuggestions,
        popular: popular.map(p => ({ text: p.word, frequency: p.frequency })),
      };
    } catch (error) {
      logger.error('Auto-complete failed', { query, error });
      return { suggestions: [], popular: [] };
    }
  }

  // Advanced search with multiple strategies
  async advancedSearch(options: SearchOptions & {
    searchType?: 'exact' | 'fuzzy' | 'prefix' | 'contains';
    boost?: {
      name?: number;
      category?: number;
      brand?: number;
      description?: number;
    };
  }): Promise<FacetedSearchResult> {
    const { searchType = 'exact', boost = {} } = options;

    // Adjust search based on type
    switch (searchType) {
      case 'fuzzy':
        return this.search({ ...options, useFuzzy: true });

      case 'prefix':
        // Use trie-based prefix search for fast results
        const prefixResults = await this.triePrefixSearch(options);
        return prefixResults;

      case 'contains':
        // Use contains search
        const containsResults = await this.trieContainsSearch(options);
        return containsResults;

      case 'exact':
      default:
        return this.search(options);
    }
  }

  // Trie-based prefix search (fast)
  private async triePrefixSearch(options: SearchOptions): Promise<FacetedSearchResult> {
    const { query = '', filters = {}, page = 1, limit = 20 } = options;

    try {
      // Get product IDs from trie
      const productSuggestions = productNameTrie.getSuggestionsWithProducts(query);
      const categorySuggestions = categoryNameTrie.getSuggestionsWithProducts(query);
      const brandSuggestions = brandTrie.getSuggestionsWithProducts(query);

      // Combine all product IDs
      const productIds = new Set<string>();
      [...productSuggestions, ...categorySuggestions, ...brandSuggestions]
        .forEach(suggestion => {
          suggestion.productIds?.forEach(id => productIds.add(id));
        });

      if (productIds.size === 0) {
        return {
          products: [],
          total: 0,
          facets: { categories: [], brands: [], priceRanges: [], tags: [] },
          suggestions: [],
          took: 0,
          appliedFilters: filters,
          availableFilters: { categories: [], brands: [], priceRanges: [], tags: [] },
        };
      }

      // Get products from database with filters
      const offset = (page - 1) * limit;
      const whereConditions = [sql`${products.id} IN ${Array.from(productIds)}`];

      // Apply additional filters
      if (filters.category) {
        // This would need category relationship
      }
      if (filters.priceMin !== undefined) {
        whereConditions.push(sql`${products.price} >= ${filters.priceMin}`);
      }
      if (filters.priceMax !== undefined) {
        whereConditions.push(sql`${products.price} <= ${filters.priceMax}`);
      }
      if (filters.inStock) {
        whereConditions.push(sql`${products.stock} > 0`);
      }

      const dbProducts = await db.query.products.findMany({
        where: sql.join(whereConditions, sql` AND `),
        with: { category: true },
        limit,
        offset,
      });

      // Transform to ProductDocument format
      const products: ProductDocument[] = dbProducts.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description || undefined,
        price: parseFloat(p.price),
        stock: p.stock,
        image: p.image || undefined,
        categoryId: p.categoryId,
        categoryName: p.category?.name,
        brand: undefined,
        tags: [],
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));

      return {
        products,
        total: products.length,
        facets: { categories: [], brands: [], priceRanges: [], tags: [] },
        suggestions: [],
        took: 0,
        appliedFilters: filters,
        availableFilters: { categories: [], brands: [], priceRanges: [], tags: [] },
      };
    } catch (error) {
      logger.error('Trie prefix search failed', { options, error });
      return {
        products: [],
        total: 0,
        facets: { categories: [], brands: [], priceRanges: [], tags: [] },
        suggestions: [],
        took: 0,
        appliedFilters: filters,
        availableFilters: { categories: [], brands: [], priceRanges: [], tags: [] },
      };
    }
  }

  // Trie-based contains search
  private async trieContainsSearch(options: SearchOptions): Promise<FacetedSearchResult> {
    const { query = '', filters = {}, page = 1, limit = 20 } = options;

    try {
      // Get suggestions that contain the query
      const productSuggestions = productNameTrie.searchContains(query);
      const categorySuggestions = categoryNameTrie.searchContains(query);
      const brandSuggestions = brandTrie.searchContains(query);

      // For contains search, we need to search the database
      // This is a simplified version - in production, you'd use Elasticsearch
      const searchTerms = [query, ...productSuggestions, ...categorySuggestions, ...brandSuggestions];

      const dbProducts = await db.query.products.findMany({
        where: sql`(${products.name} ILIKE ${`%${query}%`} OR ${products.description} ILIKE ${`%${query}%`})`,
        with: { category: true },
        limit,
        offset: (page - 1) * limit,
      });

      const products: ProductDocument[] = dbProducts.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description || undefined,
        price: parseFloat(p.price),
        stock: p.stock,
        image: p.image || undefined,
        categoryId: p.categoryId,
        categoryName: p.category?.name,
        brand: undefined,
        tags: [],
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      }));

      return {
        products,
        total: products.length,
        facets: { categories: [], brands: [], priceRanges: [], tags: [] },
        suggestions: [],
        took: 0,
        appliedFilters: filters,
        availableFilters: { categories: [], brands: [], priceRanges: [], tags: [] },
      };
    } catch (error) {
      logger.error('Trie contains search failed', { options, error });
      return {
        products: [],
        total: 0,
        facets: { categories: [], brands: [], priceRanges: [], tags: [] },
        suggestions: [],
        took: 0,
        appliedFilters: filters,
        availableFilters: { categories: [], brands: [], priceRanges: [], tags: [] },
      };
    }
  }

  // Index a single product
  async indexProduct(product: ProductDocument): Promise<void> {
    await elasticsearchService.indexProduct(product);

    // Update tries
    const trieData = {
      id: product.id,
      name: product.name,
      category: product.categoryName ? { name: product.categoryName } : undefined,
      brand: product.brand,
    };
    await initializeTries([trieData]);

    // Clear cache
    this.clearCache();
  }

  // Update a product
  async updateProduct(productId: string, updates: Partial<ProductDocument>): Promise<void> {
    await elasticsearchService.updateProduct(productId, updates);
    this.clearCache();
  }

  // Delete a product
  async deleteProduct(productId: string): Promise<void> {
    await elasticsearchService.deleteProduct(productId);
    this.clearCache();
  }

  // Get search statistics
  getStats(): {
    cacheSize: number;
    trieStats: any;
    elasticsearchHealth: any;
  } {
    return {
      cacheSize: this.cache.size,
      trieStats: {
        products: productNameTrie.getStats(),
        categories: categoryNameTrie.getStats(),
        brands: brandTrie.getStats(),
      },
      elasticsearchHealth: null, // Would need to call elasticsearchService.healthCheck()
    };
  }

  // Clear cache
  private clearCache(): void {
    this.cache.clear();
  }

  // Generate cache key
  private generateCacheKey(options: SearchOptions): string {
    return JSON.stringify({
      query: options.query,
      filters: options.filters,
      page: options.page,
      limit: options.limit,
      sortBy: options.sortBy,
      useFuzzy: options.useFuzzy,
      fuzzyDistance: options.fuzzyDistance,
    });
  }
}

// Global search service instance
export const searchService = new SearchService();

// Initialize on import
searchService.initialize().catch(error => {
  logger.error('Failed to initialize search service', error);
});
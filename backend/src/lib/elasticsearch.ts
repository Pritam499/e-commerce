import { Client } from '@elastic/elasticsearch';
import { logger } from './logger';

export interface ProductDocument {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  image?: string;
  categoryId: string;
  categoryName?: string;
  brand?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  searchScore?: number;
}

export interface SearchFilters {
  category?: string;
  brand?: string;
  priceMin?: number;
  priceMax?: number;
  inStock?: boolean;
  tags?: string[];
}

export interface SearchResult {
  products: ProductDocument[];
  total: number;
  facets: {
    categories: Array<{ key: string; count: number }>;
    brands: Array<{ key: string; count: number }>;
    priceRanges: Array<{ key: string; min: number; max: number; count: number }>;
    tags: Array<{ key: string; count: number }>;
  };
  suggestions: string[];
  took: number;
}

export class ElasticsearchService {
  private client: Client;
  private indexName = 'products';
  private initialized = false;

  constructor(node: string = 'http://localhost:9200') {
    this.client = new Client({ node });
  }

  // Initialize index with proper mappings
  async initializeIndex(): Promise<void> {
    if (this.initialized) return;

    try {
      // Check if index exists
      const indexExists = await this.client.indices.exists({ index: this.indexName });

      if (!indexExists) {
        // Create index with mappings
        await this.client.indices.create({
          index: this.indexName,
          settings: {
            settings: {
              number_of_shards: 1,
              number_of_replicas: 0,
              analysis: {
                analyzer: {
                  custom_analyzer: {
                    type: 'custom',
                    tokenizer: 'standard',
                    filter: ['lowercase', 'stop', 'porter_stem']
                  },
                  autocomplete_analyzer: {
                    type: 'custom',
                    tokenizer: 'edge_ngram_tokenizer',
                    filter: ['lowercase']
                  }
                },
                tokenizer: {
                  edge_ngram_tokenizer: {
                    type: 'edge_ngram',
                    min_gram: 2,
                    max_gram: 20,
                    token_chars: ['letter', 'digit']
                  }
                }
              }
            },
            mappings: {
              properties: {
                id: { type: 'keyword' },
                name: {
                  type: 'text',
                  analyzer: 'custom_analyzer',
                  fields: {
                    autocomplete: {
                      type: 'text',
                      analyzer: 'autocomplete_analyzer'
                    },
                    keyword: {
                      type: 'keyword'
                    }
                  }
                },
                description: {
                  type: 'text',
                  analyzer: 'custom_analyzer'
                },
                price: { type: 'float' },
                stock: { type: 'integer' },
                image: { type: 'keyword' },
                categoryId: { type: 'keyword' },
                categoryName: {
                  type: 'text',
                  analyzer: 'custom_analyzer',
                  fields: {
                    keyword: { type: 'keyword' }
                  }
                },
                brand: {
                  type: 'text',
                  analyzer: 'custom_analyzer',
                  fields: {
                    keyword: { type: 'keyword' }
                  }
                },
                tags: {
                  type: 'keyword'
                },
                createdAt: { type: 'date' },
                updatedAt: { type: 'date' },
                searchScore: { type: 'float' }
              }
            }
          }
        });

        logger.info('Elasticsearch index created', { index: this.indexName });
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize Elasticsearch index', error);
      throw error;
    }
  }

  // Index a product
  async indexProduct(product: ProductDocument): Promise<void> {
    try {
      await this.client.index({
        index: this.indexName,
        id: product.id,
        document: {
          ...product,
          // Add searchable combinations
          name_suggest: product.name,
          category_brand: `${product.categoryName || ''} ${product.brand || ''}`.trim(),
          tags_combined: product.tags.join(' ')
        }
      });

      logger.debug('Product indexed', { productId: product.id });
    } catch (error) {
      logger.error('Failed to index product', { productId: product.id, error });
      throw error;
    }
  }

  // Bulk index products
  async bulkIndexProducts(products: ProductDocument[]): Promise<void> {
    if (products.length === 0) return;

    try {
      const operations = products.flatMap(product => [
        { index: { _index: this.indexName, _id: product.id } },
        {
          ...product,
          name_suggest: product.name,
          category_brand: `${product.categoryName || ''} ${product.brand || ''}`.trim(),
          tags_combined: product.tags.join(' ')
        }
      ]);

      const response = await this.client.bulk({ operations });

      if (response.errors) {
        logger.warn('Some products failed to index', {
          errors: response.items.filter(item => item.index?.error)
        });
      }

      logger.info('Bulk indexed products', {
        count: products.length,
        index: this.indexName
      });
    } catch (error) {
      logger.error('Failed to bulk index products', error);
      throw error;
    }
  }

  // Update a product
  async updateProduct(productId: string, updates: Partial<ProductDocument>): Promise<void> {
    try {
      await this.client.update({
        index: this.indexName,
        id: productId,
        body: {
          doc: {
            ...updates,
            updatedAt: new Date().toISOString()
          }
        }
      });

      logger.debug('Product updated in index', { productId });
    } catch (error) {
      logger.error('Failed to update product in index', { productId, error });
      throw error;
    }
  }

  // Delete a product
  async deleteProduct(productId: string): Promise<void> {
    try {
      await this.client.delete({
        index: this.indexName,
        id: productId
      });

      logger.debug('Product deleted from index', { productId });
    } catch (error) {
      logger.error('Failed to delete product from index', { productId, error });
      throw error;
    }
  }

  // Search products with advanced features
  async searchProducts(
    query: string,
    filters: SearchFilters = {},
    page: number = 1,
    limit: number = 20,
    sortBy: 'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'name' = 'relevance'
  ): Promise<SearchResult> {
    const startTime = Date.now();

    try {
      // Build search query
      const searchQuery = this.buildSearchQuery(query, filters);

      // Build sort configuration
      const sortConfig = this.buildSortConfig(sortBy);

      // Execute search
      const response = await this.client.search({
        index: this.indexName,
        body: {
          from: (page - 1) * limit,
          size: limit,
          query: searchQuery,
          sort: sortConfig,
          aggs: this.buildAggregations(),
          highlight: {
            fields: {
              name: {},
              description: {},
              categoryName: {},
              brand: {}
            }
          }
        }
      });

      // Process results
      const products = response.hits.hits.map(hit => ({
        ...hit._source,
        searchScore: hit._score,
        highlights: hit.highlight
      })) as ProductDocument[];

      // Process aggregations
      const facets = this.processAggregations(response.aggregations);

      // Get suggestions
      const suggestions = await this.getSuggestions(query);

      const took = Date.now() - startTime;

      logger.info('Product search executed', {
        query,
        total: response.hits.total,
        took,
        page,
        limit
      });

      return {
        products,
        total: response.hits.total as number,
        facets,
        suggestions,
        took
      };
    } catch (error) {
      logger.error('Search failed', { query, error });
      throw error;
    }
  }

  // Auto-complete suggestions
  async getSuggestions(query: string, limit: number = 10): Promise<string[]> {
    if (!query || query.length < 2) return [];

    try {
      const response = await this.client.search({
        index: this.indexName,
        body: {
          size: 0,
          aggs: {
            name_suggestions: {
              terms: {
                field: 'name.autocomplete',
                include: `${query}.*`,
                size: limit,
                order: { _count: 'desc' }
              }
            }
          }
        }
      });

      const suggestions = response.aggregations?.name_suggestions?.buckets?.map(
        (bucket: any) => bucket.key
      ) || [];

      return suggestions;
    } catch (error) {
      logger.error('Failed to get suggestions', { query, error });
      return [];
    }
  }

  // Fuzzy search for typo tolerance
  async fuzzySearch(query: string, fuzziness: number = 2): Promise<SearchResult> {
    try {
      const response = await this.client.search({
        index: this.indexName,
        body: {
          query: {
            multi_match: {
              query,
              fields: ['name^3', 'description', 'categoryName', 'brand'],
              fuzziness,
              prefix_length: 2
            }
          },
          size: 20,
          aggs: this.buildAggregations()
        }
      });

      const products = response.hits.hits.map(hit => ({
        ...hit._source,
        searchScore: hit._score
      })) as ProductDocument[];

      const facets = this.processAggregations(response.aggregations);

      return {
        products,
        total: response.hits.total as number,
        facets,
        suggestions: [],
        took: response.took
      };
    } catch (error) {
      logger.error('Fuzzy search failed', { query, error });
      throw error;
    }
  }

  private buildSearchQuery(query: string, filters: SearchFilters) {
    const must: any[] = [];
    const filter: any[] = [];

    // Main search query
    if (query) {
      must.push({
        multi_match: {
          query,
          fields: ['name^3', 'description', 'categoryName', 'brand', 'tags_combined'],
          type: 'best_fields',
          tie_breaker: 0.3
        }
      });
    }

    // Apply filters
    if (filters.category) {
      filter.push({ term: { categoryName: filters.category } });
    }

    if (filters.brand) {
      filter.push({ term: { 'brand.keyword': filters.brand } });
    }

    if (filters.priceMin !== undefined || filters.priceMax !== undefined) {
      const priceRange: any = {};
      if (filters.priceMin !== undefined) priceRange.gte = filters.priceMin;
      if (filters.priceMax !== undefined) priceRange.lte = filters.priceMax;
      filter.push({ range: { price: priceRange } });
    }

    if (filters.inStock) {
      filter.push({ range: { stock: { gt: 0 } } });
    }

    if (filters.tags && filters.tags.length > 0) {
      filter.push({ terms: { tags: filters.tags } });
    }

    return {
      bool: {
        must,
        filter
      }
    };
  }

  private buildSortConfig(sortBy: string) {
    switch (sortBy) {
      case 'price_asc':
        return [{ price: 'asc' }];
      case 'price_desc':
        return [{ price: 'desc' }];
      case 'newest':
        return [{ createdAt: 'desc' }];
      case 'name':
        return [{ 'name.keyword': 'asc' }];
      case 'relevance':
      default:
        return [{ _score: 'desc' }];
    }
  }

  private buildAggregations() {
    return {
      categories: {
        terms: {
          field: 'categoryName.keyword',
          size: 50,
          order: { _count: 'desc' }
        }
      },
      brands: {
        terms: {
          field: 'brand.keyword',
          size: 50,
          order: { _count: 'desc' }
        }
      },
      price_ranges: {
        range: {
          field: 'price',
          ranges: [
            { to: 25, key: 'Under $25' },
            { from: 25, to: 50, key: '$25 - $50' },
            { from: 50, to: 100, key: '$50 - $100' },
            { from: 100, to: 200, key: '$100 - $200' },
            { from: 200, key: '$200+' }
          ]
        }
      },
      tags: {
        terms: {
          field: 'tags',
          size: 20,
          order: { _count: 'desc' }
        }
      }
    };
  }

  private processAggregations(aggregations: any) {
    return {
      categories: aggregations?.categories?.buckets?.map((bucket: any) => ({
        key: bucket.key,
        count: bucket.doc_count
      })) || [],
      brands: aggregations?.brands?.buckets?.map((bucket: any) => ({
        key: bucket.key,
        count: bucket.doc_count
      })) || [],
      priceRanges: aggregations?.price_ranges?.buckets?.map((bucket: any) => ({
        key: bucket.key,
        min: bucket.from || 0,
        max: bucket.to || Infinity,
        count: bucket.doc_count
      })) || [],
      tags: aggregations?.tags?.buckets?.map((bucket: any) => ({
        key: bucket.key,
        count: bucket.doc_count
      })) || []
    };
  }

  // Health check
  async healthCheck(): Promise<{ status: 'ok' | 'error'; info?: any }> {
    try {
      const info = await this.client.cluster.health();
      return { status: 'ok', info };
    } catch (error) {
      logger.error('Elasticsearch health check failed', error);
      return { status: 'error' };
    }
  }

  // Get index statistics
  async getStats(): Promise<any> {
    try {
      const stats = await this.client.indices.stats({ index: this.indexName });
      return stats.indices?.[this.indexName];
    } catch (error) {
      logger.error('Failed to get index stats', error);
      return null;
    }
  }
}

// Global Elasticsearch instance
export const elasticsearchService = new ElasticsearchService();

// Initialize on import
elasticsearchService.initializeIndex().catch(error => {
  logger.error('Failed to initialize Elasticsearch', error);
});
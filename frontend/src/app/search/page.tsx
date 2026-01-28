"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { searchProducts } from "@/src/lib/api";
import Link from "next/link";
import SearchBar from "@/src/components/SearchBar";
import ProductInventory from "@/src/components/ProductInventory";

interface Product {
  id: string;
  name: string;
  description?: string;
  price: number;
  stock: number;
  image?: string;
  categoryName?: string;
  brand?: string;
  searchScore?: number;
}

interface Facet {
  key: string;
  count: number;
}

interface PriceRangeFacet {
  key: string;
  min: number;
  max: number;
  count: number;
}

interface SearchFilters {
  category?: string;
  brand?: string;
  priceMin?: number;
  priceMax?: number;
  inStock?: boolean;
  tags?: string[];
}

interface SearchResult {
  products: Product[];
  total: number;
  facets: {
    categories: Facet[];
    brands: Facet[];
    priceRanges: PriceRangeFacet[];
    tags: Facet[];
  };
  suggestions: string[];
  took: number;
}

function SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [filters, setFilters] = useState<SearchFilters>({});
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<'relevance' | 'price_asc' | 'price_desc' | 'newest' | 'name'>('relevance');

  // Load search results
  const loadResults = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const searchFilters = { ...filters };
      // Convert empty strings to undefined
      Object.keys(searchFilters).forEach(key => {
        if (searchFilters[key as keyof SearchFilters] === '') {
          delete searchFilters[key as keyof SearchFilters];
        }
      });

      const response = await searchProducts({
        q: query,
        ...searchFilters,
        page,
        limit: 20,
        sortBy,
      });

      if (response.success) {
        setResults(response.data);
      } else {
        setError(response.error || 'Search failed');
      }
    } catch (err: any) {
      setError(err.message || 'Search failed');
    } finally {
      setLoading(false);
    }
  };

  // Load results when parameters change
  useEffect(() => {
    loadResults();
  }, [query, filters, page, sortBy]);

  // Update URL when search changes
  useEffect(() => {
    if (query) {
      const params = new URLSearchParams();
      params.set('q', query);
      if (filters.category) params.set('category', filters.category);
      if (filters.brand) params.set('brand', filters.brand);
      if (filters.priceMin) params.set('priceMin', filters.priceMin?.toString() || '');
      if (filters.priceMax) params.set('priceMax', filters.priceMax?.toString() || '');
      if (filters.inStock) params.set('inStock', 'true');
      if (filters.tags?.length) params.set('tags', filters.tags.join(','));

      router.replace(`/search?${params.toString()}`, { scroll: false });
    }
  }, [query, filters, router]);

  // Handle search
  const handleSearch = (searchQuery: string) => {
    setQuery(searchQuery);
    setPage(1);
    setFilters({});
  };

  // Handle filter changes
  const handleFilterChange = (newFilters: Partial<SearchFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
    setPage(1);
  };

  // Clear all filters
  const clearFilters = () => {
    setFilters({});
    setPage(1);
  };

  // Get active filter count
  const getActiveFilterCount = () => {
    let count = 0;
    if (filters.category) count++;
    if (filters.brand) count++;
    if (filters.priceMin || filters.priceMax) count++;
    if (filters.inStock) count++;
    if (filters.tags?.length) count++;
    return count;
  };

  const activeFilterCount = getActiveFilterCount();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Search Products</h1>
          <SearchBar
            initialQuery={query}
            onSearch={handleSearch}
            className="max-w-2xl"
          />
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Filters Sidebar */}
          <div className="lg:w-64 flex-shrink-0">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Filters</h3>
                {activeFilterCount > 0 && (
                  <button
                    onClick={clearFilters}
                    className="text-sm text-indigo-600 hover:text-indigo-800"
                  >
                    Clear all ({activeFilterCount})
                  </button>
                )}
              </div>

              {/* Categories */}
              {results?.facets.categories.length > 0 && (
                <div className="mb-6">
                  <h4 className="font-medium text-gray-900 mb-3">Categories</h4>
                  <div className="space-y-2">
                    {results.facets.categories.slice(0, 10).map((category) => (
                      <label key={category.key} className="flex items-center">
                        <input
                          type="radio"
                          name="category"
                          value={category.key}
                          checked={filters.category === category.key}
                          onChange={(e) => handleFilterChange({ category: e.target.checked ? e.target.value : undefined })}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                        />
                        <span className="ml-2 text-sm text-gray-700">
                          {category.key} ({category.count})
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Brands */}
              {results?.facets.brands.length > 0 && (
                <div className="mb-6">
                  <h4 className="font-medium text-gray-900 mb-3">Brands</h4>
                  <div className="space-y-2">
                    {results.facets.brands.slice(0, 10).map((brand) => (
                      <label key={brand.key} className="flex items-center">
                        <input
                          type="radio"
                          name="brand"
                          value={brand.key}
                          checked={filters.brand === brand.key}
                          onChange={(e) => handleFilterChange({ brand: e.target.checked ? e.target.value : undefined })}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                        />
                        <span className="ml-2 text-sm text-gray-700">
                          {brand.key} ({brand.count})
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Price Ranges */}
              {results?.facets.priceRanges.length > 0 && (
                <div className="mb-6">
                  <h4 className="font-medium text-gray-900 mb-3">Price Range</h4>
                  <div className="space-y-2">
                    {results.facets.priceRanges.map((range) => (
                      <label key={range.key} className="flex items-center">
                        <input
                          type="radio"
                          name="priceRange"
                          checked={
                            filters.priceMin === range.min &&
                            (filters.priceMax === range.max || (range.max === Infinity && !filters.priceMax))
                          }
                          onChange={() => handleFilterChange({
                            priceMin: range.min,
                            priceMax: range.max === Infinity ? undefined : range.max
                          })}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                        />
                        <span className="ml-2 text-sm text-gray-700">
                          {range.key} ({range.count})
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* In Stock Filter */}
              <div className="mb-6">
                <label className="flex items-center">
                  <input
                    type="checkbox"
                    checked={filters.inStock || false}
                    onChange={(e) => handleFilterChange({ inStock: e.target.checked })}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-700">In stock only</span>
                </label>
              </div>
            </div>
          </div>

          {/* Results */}
          <div className="flex-1">
            {/* Results Header */}
            <div className="flex items-center justify-between mb-6">
              <div>
                {loading ? (
                  <div className="text-gray-600">Searching...</div>
                ) : results ? (
                  <div className="text-gray-600">
                    {results.total === 0 ? (
                      'No products found'
                    ) : (
                      `Found ${results.total} product${results.total !== 1 ? 's' : ''}`
                    )}
                    {results.took > 0 && (
                      <span className="text-sm text-gray-500 ml-2">
                        ({results.took}ms)
                      </span>
                    )}
                  </div>
                ) : null}
              </div>

              {/* Sort Options */}
              {results && results.total > 0 && (
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="relevance">Relevance</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="newest">Newest</option>
                  <option value="name">Name A-Z</option>
                </select>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-6">
                <div className="text-sm text-red-800">{error}</div>
              </div>
            )}

            {/* Products Grid */}
            {results && results.products.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                {results.products.map((product) => (
                  <div
                    key={product.id}
                    className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow"
                  >
                    <Link href={`/products/${product.id}`}>
                      {product.image ? (
                        <img
                          src={product.image}
                          alt={product.name}
                          className="w-full h-48 object-cover"
                        />
                      ) : (
                        <div className="w-full h-48 bg-gray-200 flex items-center justify-center">
                          <span className="text-gray-400">No image</span>
                        </div>
                      )}
                    </Link>

                    <div className="p-4">
                      <Link href={`/products/${product.id}`}>
                        <h3 className="font-semibold text-gray-900 mb-1 hover:text-indigo-600 transition-colors">
                          {product.name}
                        </h3>
                      </Link>

                      {product.categoryName && (
                        <p className="text-sm text-gray-500 mb-2">{product.categoryName}</p>
                      )}

                      <div className="flex items-center justify-between mb-3">
                        <span className="text-lg font-bold text-gray-900">
                          ${product.price.toFixed(2)}
                        </span>
                        <ProductInventory
                          productId={product.id}
                          initialStock={product.stock}
                        />
                      </div>

                      <Link
                        href={`/products/${product.id}`}
                        className="w-full bg-indigo-600 text-white px-4 py-2 rounded-md hover:bg-indigo-700 transition-colors text-center block"
                      >
                        View Details
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Pagination */}
            {results && results.total > 20 && (
              <div className="mt-8 flex justify-center">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => setPage(prev => Math.max(prev - 1, 1))}
                    disabled={page === 1 || loading}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Previous
                  </button>

                  <span className="text-sm text-gray-700">
                    Page {page} of {Math.ceil(results.total / 20)}
                  </span>

                  <button
                    onClick={() => setPage(prev => prev + 1)}
                    disabled={page * 20 >= results.total || loading}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {/* Suggestions */}
            {results && results.suggestions.length > 0 && (
              <div className="mt-8 bg-blue-50 border border-blue-200 rounded-md p-4">
                <h4 className="text-sm font-medium text-blue-900 mb-2">
                  Did you mean:
                </h4>
                <div className="flex flex-wrap gap-2">
                  {results.suggestions.slice(0, 5).map((suggestion, index) => (
                    <button
                      key={index}
                      onClick={() => handleSearch(suggestion)}
                      className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm hover:bg-blue-200 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600">Loading search...</div>
      </div>
    }>
      <SearchContent />
    </Suspense>
  );
}
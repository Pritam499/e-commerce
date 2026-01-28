// Trie Node structure for auto-completion
class TrieNode {
  children: Map<string, TrieNode> = new Map();
  isEndOfWord: boolean = false;
  products: Set<string> = new Set(); // Product IDs that match this prefix
  frequency: number = 0; // Search frequency for ranking
}

export class Trie {
  private root: TrieNode = new TrieNode();
  private maxSuggestions: number = 10;

  // Insert a word into the trie
  insert(word: string, productId: string): void {
    let node = this.root;
    const lowerWord = word.toLowerCase();

    for (const char of lowerWord) {
      if (!node.children.has(char)) {
        node.children.set(char, new TrieNode());
      }
      node = node.children.get(char)!;
      node.products.add(productId);
    }

    node.isEndOfWord = true;
    node.frequency++;
  }

  // Search for words starting with prefix
  searchPrefix(prefix: string): string[] {
    let node = this.root;
    const lowerPrefix = prefix.toLowerCase();

    // Navigate to the prefix node
    for (const char of lowerPrefix) {
      if (!node.children.has(char)) {
        return [];
      }
      node = node.children.get(char)!;
    }

    // Collect all words from this node
    const suggestions: Array<{ word: string; frequency: number }> = [];
    this.collectWords(node, lowerPrefix, suggestions);

    // Sort by frequency (most searched first) and return top suggestions
    return suggestions
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, this.maxSuggestions)
      .map(item => item.word);
  }

  // Search for words containing the substring (fuzzy-like)
  searchContains(substring: string): string[] {
    const results: Array<{ word: string; frequency: number }> = [];
    const lowerSubstring = substring.toLowerCase();

    this.searchContainsRecursive(this.root, '', lowerSubstring, results);

    return results
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, this.maxSuggestions)
      .map(item => item.word);
  }

  // Get suggestions with product IDs
  getSuggestionsWithProducts(prefix: string): Array<{ word: string; productIds: string[] }> {
    let node = this.root;
    const lowerPrefix = prefix.toLowerCase();

    // Navigate to the prefix node
    for (const char of lowerPrefix) {
      if (!node.children.has(char)) {
        return [];
      }
      node = node.children.get(char)!;
    }

    const suggestions: Array<{ word: string; productIds: string[]; frequency: number }> = [];
    this.collectWordsWithProducts(node, lowerPrefix, suggestions);

    return suggestions
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, this.maxSuggestions)
      .map(item => ({ word: item.word, productIds: Array.from(item.productIds) }));
  }

  private collectWords(node: TrieNode, currentWord: string, suggestions: Array<{ word: string; frequency: number }>): void {
    if (node.isEndOfWord) {
      suggestions.push({ word: currentWord, frequency: node.frequency });
    }

    for (const [char, childNode] of node.children) {
      this.collectWords(childNode, currentWord + char, suggestions);
    }
  }

  private collectWordsWithProducts(
    node: TrieNode,
    currentWord: string,
    suggestions: Array<{ word: string; productIds: string[]; frequency: number }>
  ): void {
    if (node.isEndOfWord) {
      suggestions.push({
        word: currentWord,
        productIds: Array.from(node.products),
        frequency: node.frequency
      });
    }

    for (const [char, childNode] of node.children) {
      this.collectWordsWithProducts(childNode, currentWord + char, suggestions);
    }
  }

  private searchContainsRecursive(
    node: TrieNode,
    currentWord: string,
    substring: string,
    results: Array<{ word: string; frequency: number }>
  ): void {
    if (node.isEndOfWord && currentWord.includes(substring)) {
      results.push({ word: currentWord, frequency: node.frequency });
    }

    for (const [char, childNode] of node.children) {
      this.searchContainsRecursive(childNode, currentWord + char, substring, results);
    }
  }

  // Fuzzy search - find words with small edit distance
  fuzzySearch(word: string, maxDistance: number = 2): string[] {
    const results: Array<{ word: string; distance: number; frequency: number }> = [];

    // Search the entire trie for fuzzy matches
    this.fuzzySearchRecursive(this.root, '', word.toLowerCase(), maxDistance, results);

    return results
      .sort((a, b) => a.distance - b.distance || b.frequency - a.frequency)
      .slice(0, this.maxSuggestions)
      .map(item => item.word);
  }

  private fuzzySearchRecursive(
    node: TrieNode,
    currentWord: string,
    targetWord: string,
    maxDistance: number,
    results: Array<{ word: string; distance: number; frequency: number }>
  ): void {
    if (node.isEndOfWord) {
      const distance = this.levenshteinDistance(currentWord, targetWord);
      if (distance <= maxDistance) {
        results.push({ word: currentWord, distance, frequency: node.frequency });
      }
    }

    // Prune search if current distance already exceeds max
    if (currentWord.length > 0) {
      const currentDistance = this.levenshteinDistance(currentWord, targetWord);
      if (currentDistance > maxDistance) {
        return;
      }
    }

    for (const [char, childNode] of node.children) {
      this.fuzzySearchRecursive(childNode, currentWord + char, targetWord, maxDistance, results);
    }
  }

  // Levenshtein distance for fuzzy matching
  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            matrix[i][j - 1] + 1,     // insertion
            matrix[i - 1][j] + 1      // deletion
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  // Get popular searches
  getPopularSearches(limit: number = 10): Array<{ word: string; frequency: number }> {
    const popular: Array<{ word: string; frequency: number }> = [];
    this.collectPopular(this.root, '', popular);

    return popular
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, limit);
  }

  private collectPopular(node: TrieNode, currentWord: string, popular: Array<{ word: string; frequency: number }>): void {
    if (node.isEndOfWord) {
      popular.push({ word: currentWord, frequency: node.frequency });
    }

    for (const [char, childNode] of node.children) {
      this.collectPopular(childNode, currentWord + char, popular);
    }
  }

  // Clear the trie
  clear(): void {
    this.root = new TrieNode();
  }

  // Get statistics
  getStats(): { totalWords: number; totalNodes: number; maxDepth: number } {
    let totalWords = 0;
    let totalNodes = 0;
    let maxDepth = 0;

    this.calculateStats(this.root, 0, { totalWords, totalNodes, maxDepth });

    return { totalWords, totalNodes, maxDepth };
  }

  private calculateStats(node: TrieNode, depth: number, stats: any): void {
    stats.totalNodes++;
    stats.maxDepth = Math.max(stats.maxDepth, depth);

    if (node.isEndOfWord) {
      stats.totalWords++;
    }

    for (const childNode of node.children.values()) {
      this.calculateStats(childNode, depth + 1, stats);
    }
  }
}

// Global trie instances for different search types
export const productNameTrie = new Trie();
export const categoryNameTrie = new Trie();
export const brandTrie = new Trie();

// Initialize tries with product data
export async function initializeTries(products: Array<{
  id: string;
  name: string;
  category?: { name: string };
  brand?: string;
}>): Promise<void> {
  // Clear existing data
  productNameTrie.clear();
  categoryNameTrie.clear();
  brandTrie.clear();

  for (const product of products) {
    // Index product name
    const nameWords = product.name.toLowerCase().split(/\s+/);
    for (const word of nameWords) {
      if (word.length > 2) { // Only index words longer than 2 chars
        productNameTrie.insert(word, product.id);
        productNameTrie.insert(product.name.toLowerCase(), product.id);
      }
    }

    // Index full product name
    productNameTrie.insert(product.name.toLowerCase(), product.id);

    // Index category
    if (product.category?.name) {
      categoryNameTrie.insert(product.category.name.toLowerCase(), product.id);
    }

    // Index brand
    if (product.brand) {
      brandTrie.insert(product.brand.toLowerCase(), product.id);
    }
  }
}
/**
 * ContentStore — FTS5 BM25-based knowledge base for context-mode.
 *
 * Chunks markdown content by headings (keeping code blocks intact),
 * stores in SQLite FTS5, and retrieves via BM25-ranked search.
 *
 * Use for documentation, API references, and any content where
 * you need EXACT text later — not summaries.
 */
import { EmbeddingClient } from "./embeddings.js";
import type { IndexResult, SearchResult, StoreStats } from "./types.js";
export type { IndexResult, SearchResult, StoreStats } from "./types.js";
/**
 * Remove stale DB files from previous sessions whose processes no longer exist.
 */
export declare function cleanupStaleDBs(): number;
export declare class ContentStore {
    #private;
    constructor(dbPath?: string);
    /** Delete this session's DB files. Call on process exit. */
    cleanup(): void;
    index(options: {
        content?: string;
        path?: string;
        source?: string;
    }): IndexResult;
    /**
     * Index a source code file using tree-sitter for semantic chunking.
     * Falls back to standard markdown chunking if parsing fails.
     */
    indexCode(options: {
        path: string;
        source?: string;
        language?: string;
    }): Promise<IndexResult>;
    /**
     * Index plain-text output (logs, build output, test results) by splitting
     * into fixed-size line groups. Unlike markdown indexing, this does not
     * look for headings — it chunks by line count with overlap.
     */
    indexPlainText(content: string, source: string, linesPerChunk?: number): IndexResult;
    /**
     * Index JSON content by walking the object tree and using key paths
     * as chunk titles (analogous to heading hierarchy in markdown). Objects
     * recurse by key; arrays batch items by size.
     *
     * Falls back to `indexPlainText` if the content is not valid JSON.
     */
    indexJSON(content: string, source: string, maxChunkBytes?: number): IndexResult;
    search(query: string, limit?: number, source?: string, mode?: "AND" | "OR"): SearchResult[];
    searchTrigram(query: string, limit?: number, source?: string, mode?: "AND" | "OR"): SearchResult[];
    fuzzyCorrect(query: string): string | null;
    searchWithFallback(query: string, limit?: number, source?: string): SearchResult[];
    /**
     * Store embeddings for chunks belonging to a source.
     * Called after indexing when an EmbeddingClient is available.
     */
    storeEmbeddings(sourceId: number, embeddingClient: EmbeddingClient): Promise<number>;
    /**
     * Vector search: find chunks most similar to a query embedding.
     * Brute-force cosine similarity (fast enough for <10K chunks).
     */
    searchVector(queryEmbedding: Float32Array, limit?: number, source?: string): SearchResult[];
    /**
     * Hybrid search: combine BM25 and vector results using Reciprocal Rank Fusion.
     * Falls back to BM25-only if no embeddings are available.
     */
    searchHybrid(bm25Results: SearchResult[], vectorResults: SearchResult[], limit?: number): SearchResult[];
    /**
     * Check if any embeddings exist in the database.
     */
    hasEmbeddings(): boolean;
    listSources(): Array<{
        label: string;
        chunkCount: number;
    }>;
    /**
     * Get all chunks for a given source by ID — bypasses FTS5 MATCH entirely.
     * Use this for inventory/listing where you need all sections, not search.
     */
    getChunksBySource(sourceId: number): SearchResult[];
    getDistinctiveTerms(sourceId: number, maxTerms?: number): string[];
    getStats(): StoreStats;
    close(): void;
}

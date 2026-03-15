/**
 * Embedding client using OpenRouter API.
 * Provides vector embeddings for hybrid BM25 + semantic search.
 * Feature toggle: only active when OPENROUTER_API_KEY env var is set.
 */
export declare class EmbeddingClient {
    #private;
    constructor(apiKey: string, model?: string);
    /**
     * Embed one or more texts. Returns Float32Array for each input.
     * Batches to avoid token limits (max 20 texts per call).
     */
    embed(texts: string[]): Promise<Float32Array[]>;
    /**
     * Embed a single text. Convenience wrapper.
     */
    embedOne(text: string): Promise<Float32Array>;
}
/**
 * Compute cosine similarity between two vectors.
 * Returns -1.0 to 1.0 (1.0 = identical direction).
 */
export declare function cosineSimilarity(a: Float32Array, b: Float32Array): number;
/**
 * Create an EmbeddingClient from environment variable.
 * Returns null if OPENROUTER_API_KEY is not set.
 */
export declare function createEmbeddingClient(): EmbeddingClient | null;

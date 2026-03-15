/**
 * Embedding client using OpenRouter API.
 * Provides vector embeddings for hybrid BM25 + semantic search.
 * Feature toggle: only active when OPENROUTER_API_KEY env var is set.
 */
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/embeddings";
const DEFAULT_MODEL = "openai/text-embedding-3-small";
const EMBEDDING_DIM = 1536;
export class EmbeddingClient {
    #apiKey;
    #model;
    constructor(apiKey, model = DEFAULT_MODEL) {
        this.#apiKey = apiKey;
        this.#model = model;
    }
    /**
     * Embed one or more texts. Returns Float32Array for each input.
     * Batches to avoid token limits (max 20 texts per call).
     */
    async embed(texts) {
        const results = [];
        const batchSize = 20;
        for (let i = 0; i < texts.length; i += batchSize) {
            const batch = texts.slice(i, i + batchSize);
            // Truncate each text to ~8000 chars to stay within token limits
            const truncated = batch.map(t => t.length > 8000 ? t.slice(0, 8000) : t);
            const response = await fetch(OPENROUTER_API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${this.#apiKey}`,
                },
                body: JSON.stringify({
                    model: this.#model,
                    input: truncated,
                }),
                signal: AbortSignal.timeout(10000),
            });
            if (!response.ok) {
                const errorText = await response.text().catch(() => "unknown error");
                throw new Error(`OpenRouter embedding API error ${response.status}: ${errorText}`);
            }
            const data = await response.json();
            // Sort by index (API may not return in order)
            const sorted = data.data.sort((a, b) => a.index - b.index);
            for (const item of sorted) {
                results.push(new Float32Array(item.embedding));
            }
        }
        return results;
    }
    /**
     * Embed a single text. Convenience wrapper.
     */
    async embedOne(text) {
        const [result] = await this.embed([text]);
        return result;
    }
}
/**
 * Compute cosine similarity between two vectors.
 * Returns -1.0 to 1.0 (1.0 = identical direction).
 */
export function cosineSimilarity(a, b) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
}
/**
 * Create an EmbeddingClient from environment variable.
 * Returns null if OPENROUTER_API_KEY is not set.
 */
export function createEmbeddingClient() {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey)
        return null;
    return new EmbeddingClient(apiKey);
}

/**
 * ContentStore — FTS5 BM25-based knowledge base for context-mode.
 *
 * Chunks markdown content by headings (keeping code blocks intact),
 * stores in SQLite FTS5, and retrieves via BM25-ranked search.
 *
 * Use for documentation, API references, and any content where
 * you need EXACT text later — not summaries.
 */
import { loadDatabase, applyWALPragmas } from "./db-base.js";
import { readFileSync, readdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chunkCode, detectLanguage } from "./chunker-code.js";
import { cosineSimilarity } from "./embeddings.js";
// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────
const STOPWORDS = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
    "her", "was", "one", "our", "out", "has", "his", "how", "its", "may",
    "new", "now", "old", "see", "way", "who", "did", "get", "got", "let",
    "say", "she", "too", "use", "will", "with", "this", "that", "from",
    "they", "been", "have", "many", "some", "them", "than", "each", "make",
    "like", "just", "over", "such", "take", "into", "year", "your", "good",
    "could", "would", "about", "which", "their", "there", "other", "after",
    "should", "through", "also", "more", "most", "only", "very", "when",
    "what", "then", "these", "those", "being", "does", "done", "both",
    "same", "still", "while", "where", "here", "were", "much",
    // Common in code/changelogs
    "update", "updates", "updated", "deps", "dev", "tests", "test",
    "add", "added", "fix", "fixed", "run", "running", "using",
]);
// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────
function sanitizeQuery(query, mode = "AND") {
    const words = query
        .replace(/['"(){}[\]*:^~]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 0 &&
        !["AND", "OR", "NOT", "NEAR"].includes(w.toUpperCase()));
    if (words.length === 0)
        return '""';
    return words.map((w) => `"${w}"`).join(mode === "OR" ? " OR " : " ");
}
function sanitizeTrigramQuery(query, mode = "AND") {
    const cleaned = query.replace(/["'(){}[\]*:^~]/g, "").trim();
    if (cleaned.length < 3)
        return "";
    const words = cleaned.split(/\s+/).filter((w) => w.length >= 3);
    if (words.length === 0)
        return "";
    return words.map((w) => `"${w}"`).join(mode === "OR" ? " OR " : " ");
}
function levenshtein(a, b) {
    if (a.length === 0)
        return b.length;
    if (b.length === 0)
        return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const curr = [i];
        for (let j = 1; j <= b.length; j++) {
            curr[j] =
                a[i - 1] === b[j - 1]
                    ? prev[j - 1]
                    : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
        }
        prev = curr;
    }
    return prev[b.length];
}
function maxEditDistance(wordLength) {
    if (wordLength <= 4)
        return 1;
    if (wordLength <= 12)
        return 2;
    return 3;
}
// Oversized chunks (e.g., a 50KB section between two headings) hurt BM25
// length normalization and produce unwieldy search results. Split at paragraph
// boundaries when a chunk exceeds this cap.
const MAX_CHUNK_BYTES = 4096;
// ─────────────────────────────────────────────────────────
// ContentStore
// ─────────────────────────────────────────────────────────
/**
 * Remove stale DB files from previous sessions whose processes no longer exist.
 */
export function cleanupStaleDBs() {
    const dir = tmpdir();
    let cleaned = 0;
    try {
        const files = readdirSync(dir);
        for (const file of files) {
            const match = file.match(/^context-mode-(\d+)\.db$/);
            if (!match)
                continue;
            const pid = parseInt(match[1], 10);
            if (pid === process.pid)
                continue;
            try {
                process.kill(pid, 0);
            }
            catch {
                const base = join(dir, file);
                for (const suffix of ["", "-wal", "-shm"]) {
                    try {
                        unlinkSync(base + suffix);
                    }
                    catch { /* ignore */ }
                }
                cleaned++;
            }
        }
    }
    catch { /* ignore readdir errors */ }
    return cleaned;
}
export class ContentStore {
    #db;
    #dbPath;
    // ── Cached Prepared Statements ──
    // Prepared once at construction, reused on every call to avoid
    // re-compiling SQL on each invocation.
    // Write path
    #stmtInsertSourceEmpty;
    #stmtInsertSource;
    #stmtInsertChunk;
    #stmtInsertChunkTrigram;
    #stmtInsertVocab;
    // Dedup path (delete previous source with same label before re-indexing)
    #stmtDeleteChunksByLabel;
    #stmtDeleteChunksTrigramByLabel;
    #stmtDeleteSourcesByLabel;
    // Search path (hot)
    #stmtSearchPorter;
    #stmtSearchPorterFiltered;
    #stmtSearchTrigram;
    #stmtSearchTrigramFiltered;
    #stmtFuzzyVocab;
    // Read path
    #stmtListSources;
    #stmtChunksBySource;
    #stmtSourceChunkCount;
    #stmtChunkContent;
    #stmtStats;
    constructor(dbPath) {
        const Database = loadDatabase();
        this.#dbPath =
            dbPath ?? join(tmpdir(), `context-mode-${process.pid}.db`);
        this.#db = new Database(this.#dbPath, { timeout: 5000 });
        applyWALPragmas(this.#db);
        this.#initSchema();
        this.#prepareStatements();
    }
    /** Delete this session's DB files. Call on process exit. */
    cleanup() {
        try {
            this.#db.close();
        }
        catch { /* ignore */ }
        for (const suffix of ["", "-wal", "-shm"]) {
            try {
                unlinkSync(this.#dbPath + suffix);
            }
            catch { /* ignore */ }
        }
    }
    // ── Schema ──
    #initSchema() {
        this.#db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        code_chunk_count INTEGER NOT NULL DEFAULT 0,
        indexed_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks USING fts5(
        title,
        content,
        source_id UNINDEXED,
        content_type UNINDEXED,
        tokenize='porter unicode61'
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_trigram USING fts5(
        title,
        content,
        source_id UNINDEXED,
        content_type UNINDEXED,
        tokenize='trigram'
      );

      CREATE TABLE IF NOT EXISTS vocabulary (
        word TEXT PRIMARY KEY
      );

      CREATE TABLE IF NOT EXISTS embeddings (
        chunk_rowid INTEGER PRIMARY KEY,
        source_id INTEGER NOT NULL,
        embedding BLOB NOT NULL
      );
    `);
    }
    #prepareStatements() {
        // Write path
        this.#stmtInsertSourceEmpty = this.#db.prepare("INSERT INTO sources (label, chunk_count, code_chunk_count) VALUES (?, 0, 0)");
        this.#stmtInsertSource = this.#db.prepare("INSERT INTO sources (label, chunk_count, code_chunk_count) VALUES (?, ?, ?)");
        this.#stmtInsertChunk = this.#db.prepare("INSERT INTO chunks (title, content, source_id, content_type) VALUES (?, ?, ?, ?)");
        this.#stmtInsertChunkTrigram = this.#db.prepare("INSERT INTO chunks_trigram (title, content, source_id, content_type) VALUES (?, ?, ?, ?)");
        this.#stmtInsertVocab = this.#db.prepare("INSERT OR IGNORE INTO vocabulary (word) VALUES (?)");
        // Dedup path: delete previous source with same label before re-indexing
        // Prevents stale outputs from accumulating in iterative workflows (build-fix-build)
        this.#stmtDeleteChunksByLabel = this.#db.prepare("DELETE FROM chunks WHERE source_id IN (SELECT id FROM sources WHERE label = ?)");
        this.#stmtDeleteChunksTrigramByLabel = this.#db.prepare("DELETE FROM chunks_trigram WHERE source_id IN (SELECT id FROM sources WHERE label = ?)");
        this.#stmtDeleteSourcesByLabel = this.#db.prepare("DELETE FROM sources WHERE label = ?");
        // Search path (hot)
        this.#stmtSearchPorter = this.#db.prepare(`
      SELECT
        chunks.title,
        chunks.content,
        chunks.content_type,
        sources.label,
        bm25(chunks, 2.0, 1.0) AS rank,
        highlight(chunks, 1, char(2), char(3)) AS highlighted
      FROM chunks
      JOIN sources ON sources.id = chunks.source_id
      WHERE chunks MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
        this.#stmtSearchPorterFiltered = this.#db.prepare(`
      SELECT
        chunks.title,
        chunks.content,
        chunks.content_type,
        sources.label,
        bm25(chunks, 2.0, 1.0) AS rank,
        highlight(chunks, 1, char(2), char(3)) AS highlighted
      FROM chunks
      JOIN sources ON sources.id = chunks.source_id
      WHERE chunks MATCH ? AND sources.label LIKE ?
      ORDER BY rank
      LIMIT ?
    `);
        this.#stmtSearchTrigram = this.#db.prepare(`
      SELECT
        chunks_trigram.title,
        chunks_trigram.content,
        chunks_trigram.content_type,
        sources.label,
        bm25(chunks_trigram, 2.0, 1.0) AS rank,
        highlight(chunks_trigram, 1, char(2), char(3)) AS highlighted
      FROM chunks_trigram
      JOIN sources ON sources.id = chunks_trigram.source_id
      WHERE chunks_trigram MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
        this.#stmtSearchTrigramFiltered = this.#db.prepare(`
      SELECT
        chunks_trigram.title,
        chunks_trigram.content,
        chunks_trigram.content_type,
        sources.label,
        bm25(chunks_trigram, 2.0, 1.0) AS rank,
        highlight(chunks_trigram, 1, char(2), char(3)) AS highlighted
      FROM chunks_trigram
      JOIN sources ON sources.id = chunks_trigram.source_id
      WHERE chunks_trigram MATCH ? AND sources.label LIKE ?
      ORDER BY rank
      LIMIT ?
    `);
        // Fuzzy path
        this.#stmtFuzzyVocab = this.#db.prepare("SELECT word FROM vocabulary WHERE length(word) BETWEEN ? AND ?");
        // Read path
        this.#stmtListSources = this.#db.prepare("SELECT label, chunk_count as chunkCount FROM sources ORDER BY id DESC");
        this.#stmtChunksBySource = this.#db.prepare(`SELECT c.title, c.content, c.content_type, s.label
       FROM chunks c
       JOIN sources s ON s.id = c.source_id
       WHERE c.source_id = ?
       ORDER BY c.rowid`);
        this.#stmtSourceChunkCount = this.#db.prepare("SELECT chunk_count FROM sources WHERE id = ?");
        this.#stmtChunkContent = this.#db.prepare("SELECT content FROM chunks WHERE source_id = ?");
        this.#stmtStats = this.#db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM sources) AS sources,
        (SELECT COUNT(*) FROM chunks) AS chunks,
        (SELECT COUNT(*) FROM chunks WHERE content_type = 'code') AS codeChunks
    `);
    }
    // ── Index ──
    index(options) {
        const { content, path, source } = options;
        if (!content && !path) {
            throw new Error("Either content or path must be provided");
        }
        const text = content ?? readFileSync(path, "utf-8");
        const label = source ?? path ?? "untitled";
        const chunks = this.#chunkMarkdown(text);
        return this.#insertChunks(chunks, label, text);
    }
    // ── Index Code (tree-sitter) ──
    /**
     * Index a source code file using tree-sitter for semantic chunking.
     * Falls back to standard markdown chunking if parsing fails.
     */
    async indexCode(options) {
        const { path: filePath, source: label } = options;
        const content = readFileSync(filePath, "utf-8");
        const language = options.language ?? detectLanguage(filePath);
        if (!language) {
            // Not a recognized code file, fall back to standard index
            return this.index({ path: filePath, source: label });
        }
        try {
            const chunks = await chunkCode(content, language);
            const sourceLabel = label ?? `code:${filePath.split("/").pop()}`;
            return this.#insertChunks(chunks, sourceLabel, content);
        }
        catch {
            // Tree-sitter failed, fall back to standard indexing
            return this.index({ path: filePath, source: label });
        }
    }
    // ── Index Plain Text ──
    /**
     * Index plain-text output (logs, build output, test results) by splitting
     * into fixed-size line groups. Unlike markdown indexing, this does not
     * look for headings — it chunks by line count with overlap.
     */
    indexPlainText(content, source, linesPerChunk = 20) {
        if (!content || content.trim().length === 0) {
            return this.#insertChunks([], source, "");
        }
        const chunks = this.#chunkPlainText(content, linesPerChunk);
        return this.#insertChunks(chunks.map((c) => ({ ...c, hasCode: false })), source, content);
    }
    // ── Index JSON ──
    /**
     * Index JSON content by walking the object tree and using key paths
     * as chunk titles (analogous to heading hierarchy in markdown). Objects
     * recurse by key; arrays batch items by size.
     *
     * Falls back to `indexPlainText` if the content is not valid JSON.
     */
    indexJSON(content, source, maxChunkBytes = MAX_CHUNK_BYTES) {
        if (!content || content.trim().length === 0) {
            return this.indexPlainText("", source);
        }
        let parsed;
        try {
            parsed = JSON.parse(content);
        }
        catch {
            return this.indexPlainText(content, source);
        }
        const chunks = [];
        this.#walkJSON(parsed, [], chunks, maxChunkBytes);
        if (chunks.length === 0) {
            return this.indexPlainText(content, source);
        }
        return this.#insertChunks(chunks, source, content);
    }
    // ── Shared DB Insertion ──
    /**
     * Compute trigram Jaccard similarity between two strings.
     * Returns 0.0 (no overlap) to 1.0 (identical).
     */
    #trigramSimilarity(a, b) {
        const trigrams = (s) => {
            const t = new Set();
            const lower = s.toLowerCase();
            for (let i = 0; i <= lower.length - 3; i++) {
                t.add(lower.slice(i, i + 3));
            }
            return t;
        };
        const ta = trigrams(a);
        const tb = trigrams(b);
        if (ta.size === 0 || tb.size === 0)
            return 0;
        let intersection = 0;
        for (const t of ta) {
            if (tb.has(t))
                intersection++;
        }
        return intersection / (ta.size + tb.size - intersection);
    }
    /**
     * Find an existing chunk that overlaps significantly with the new chunk.
     * Returns the rowid and content if found, null otherwise.
     * Only searches chunks from OTHER sources (not the same label).
     */
    #findConsolidationTarget(chunk, label) {
        try {
            // Extract key terms from title for BM25 search
            const terms = chunk.title.split(/[\s:]+/).filter(t => t.length > 2).join(" ");
            if (!terms)
                return null;
            const sanitized = terms.replace(/['"(){}[\]^~*?:!@#$%&]/g, "").trim();
            if (!sanitized)
                return null;
            const rows = this.#db.prepare(`
        SELECT chunks.rowid, chunks.content, chunks.source_id
        FROM chunks
        JOIN sources ON sources.id = chunks.source_id
        WHERE chunks MATCH ? AND sources.label != ?
        ORDER BY bm25(chunks, 2.0, 1.0)
        LIMIT 5
      `).all(sanitized, label);
            for (const row of rows) {
                const similarity = this.#trigramSimilarity(chunk.content, row.content);
                if (similarity > 0.7) {
                    return { rowid: row.rowid, content: row.content, sourceId: row.source_id };
                }
            }
        }
        catch {
            // BM25 match may fail on certain query patterns, skip consolidation
        }
        return null;
    }
    /**
     * Shared DB insertion logic for all index methods. Inserts chunks
     * into both FTS5 tables within a transaction and extracts vocabulary.
     * Uses cached prepared statements from #prepareStatements().
     *
     * When consolidate is true, checks for existing related chunks from
     * other sources and merges overlapping content instead of duplicating.
     */
    #insertChunks(chunks, label, text, consolidate = false) {
        const codeChunks = chunks.filter((c) => c.hasCode).length;
        let mergedChunks = 0;
        // Consolidation: check for mergeable chunks before the transaction
        const mergeTargets = new Map();
        const chunksToInsert = [];
        if (consolidate && chunks.length > 0) {
            for (const chunk of chunks) {
                const target = this.#findConsolidationTarget(chunk, label);
                if (target) {
                    // Append only truly new content
                    const combined = target.content + "\n\n" + chunk.content;
                    mergeTargets.set(target.rowid, { rowid: target.rowid, newContent: combined, sourceId: target.sourceId });
                    mergedChunks++;
                }
                else {
                    chunksToInsert.push(chunk);
                }
            }
        }
        else {
            chunksToInsert.push(...chunks);
        }
        // Atomic dedup + insert: delete previous source with same label,
        // then insert new content — all within a single transaction.
        // Prevents stale results in iterative workflows. (See: GitHub issue #67)
        const transaction = this.#db.transaction(() => {
            this.#stmtDeleteChunksByLabel.run(label);
            this.#stmtDeleteChunksTrigramByLabel.run(label);
            this.#stmtDeleteSourcesByLabel.run(label);
            // Apply merges to existing chunks from other sources
            for (const [, merge] of mergeTargets) {
                this.#db.prepare("UPDATE chunks SET content = ? WHERE rowid = ?").run(merge.newContent, merge.rowid);
                this.#db.prepare("UPDATE chunks_trigram SET content = ? WHERE rowid = ?").run(merge.newContent, merge.rowid);
            }
            if (chunksToInsert.length === 0 && mergedChunks === 0) {
                const info = this.#stmtInsertSourceEmpty.run(label);
                return Number(info.lastInsertRowid);
            }
            const info = this.#stmtInsertSource.run(label, chunksToInsert.length + mergedChunks, codeChunks);
            const sourceId = Number(info.lastInsertRowid);
            for (const chunk of chunksToInsert) {
                const ct = chunk.hasCode ? "code" : "prose";
                this.#stmtInsertChunk.run(chunk.title, chunk.content, sourceId, ct);
                this.#stmtInsertChunkTrigram.run(chunk.title, chunk.content, sourceId, ct);
            }
            return sourceId;
        });
        const sourceId = transaction();
        if (text)
            this.#extractAndStoreVocabulary(text);
        return {
            sourceId,
            label,
            totalChunks: chunksToInsert.length + mergedChunks,
            codeChunks,
            mergedChunks: mergedChunks > 0 ? mergedChunks : undefined,
        };
    }
    // ── Search ──
    search(query, limit = 3, source, mode = "AND") {
        const sanitized = sanitizeQuery(query, mode);
        const stmt = source
            ? this.#stmtSearchPorterFiltered
            : this.#stmtSearchPorter;
        const params = source
            ? [sanitized, `%${source}%`, limit]
            : [sanitized, limit];
        const rows = stmt.all(...params);
        return rows.map((r) => ({
            title: r.title,
            content: r.content,
            source: r.label,
            rank: r.rank,
            contentType: r.content_type,
            highlighted: r.highlighted,
        }));
    }
    // ── Trigram Search (Layer 2) ──
    searchTrigram(query, limit = 3, source, mode = "AND") {
        const sanitized = sanitizeTrigramQuery(query, mode);
        if (!sanitized)
            return [];
        const stmt = source
            ? this.#stmtSearchTrigramFiltered
            : this.#stmtSearchTrigram;
        const params = source
            ? [sanitized, `%${source}%`, limit]
            : [sanitized, limit];
        const rows = stmt.all(...params);
        return rows.map((r) => ({
            title: r.title,
            content: r.content,
            source: r.label,
            rank: r.rank,
            contentType: r.content_type,
            highlighted: r.highlighted,
        }));
    }
    // ── Fuzzy Correction (Layer 3) ──
    fuzzyCorrect(query) {
        const word = query.toLowerCase().trim();
        if (word.length < 3)
            return null;
        const maxDist = maxEditDistance(word.length);
        const candidates = this.#stmtFuzzyVocab.all(word.length - maxDist, word.length + maxDist);
        let bestWord = null;
        let bestDist = maxDist + 1;
        for (const { word: candidate } of candidates) {
            if (candidate === word)
                return null; // exact match — no correction
            const dist = levenshtein(word, candidate);
            if (dist < bestDist) {
                bestDist = dist;
                bestWord = candidate;
            }
        }
        return bestDist <= maxDist ? bestWord : null;
    }
    // ── Unified Fallback Search ──
    searchWithFallback(query, limit = 3, source) {
        // Layer 1a: Porter + AND (most precise)
        const porterAnd = this.search(query, limit, source, "AND");
        if (porterAnd.length > 0) {
            return porterAnd.map((r) => ({ ...r, matchLayer: "porter" }));
        }
        // Layer 1b: Porter + OR (fallback when AND finds nothing)
        const porterOr = this.search(query, limit, source, "OR");
        if (porterOr.length > 0) {
            return porterOr.map((r) => ({ ...r, matchLayer: "porter" }));
        }
        // Layer 2a: Trigram + AND
        const trigramAnd = this.searchTrigram(query, limit, source, "AND");
        if (trigramAnd.length > 0) {
            return trigramAnd.map((r) => ({
                ...r,
                matchLayer: "trigram",
            }));
        }
        // Layer 2b: Trigram + OR
        const trigramOr = this.searchTrigram(query, limit, source, "OR");
        if (trigramOr.length > 0) {
            return trigramOr.map((r) => ({
                ...r,
                matchLayer: "trigram",
            }));
        }
        // Layer 3: Fuzzy correction + re-search (AND then OR)
        const words = query
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .filter((w) => w.length >= 3);
        const original = words.join(" ");
        const correctedWords = words.map((w) => this.fuzzyCorrect(w) ?? w);
        const correctedQuery = correctedWords.join(" ");
        if (correctedQuery !== original) {
            const fuzzyPorterAnd = this.search(correctedQuery, limit, source, "AND");
            if (fuzzyPorterAnd.length > 0) {
                return fuzzyPorterAnd.map((r) => ({ ...r, matchLayer: "fuzzy" }));
            }
            const fuzzyPorterOr = this.search(correctedQuery, limit, source, "OR");
            if (fuzzyPorterOr.length > 0) {
                return fuzzyPorterOr.map((r) => ({ ...r, matchLayer: "fuzzy" }));
            }
            const fuzzyTrigramAnd = this.searchTrigram(correctedQuery, limit, source, "AND");
            if (fuzzyTrigramAnd.length > 0) {
                return fuzzyTrigramAnd.map((r) => ({ ...r, matchLayer: "fuzzy" }));
            }
            const fuzzyTrigramOr = this.searchTrigram(correctedQuery, limit, source, "OR");
            if (fuzzyTrigramOr.length > 0) {
                return fuzzyTrigramOr.map((r) => ({ ...r, matchLayer: "fuzzy" }));
            }
        }
        return [];
    }
    // ── Embedding / Vector Search ──
    /**
     * Store embeddings for chunks belonging to a source.
     * Called after indexing when an EmbeddingClient is available.
     */
    async storeEmbeddings(sourceId, embeddingClient) {
        // Get all chunks for this source
        const chunks = this.#stmtChunkContent.all(sourceId);
        if (chunks.length === 0)
            return 0;
        // Get chunk rowids
        const rowids = this.#db.prepare("SELECT rowid FROM chunks WHERE source_id = ? ORDER BY rowid").all(sourceId);
        // Embed all chunks
        const texts = chunks.map(c => c.content);
        const embeddings = await embeddingClient.embed(texts);
        // Store in DB
        const insert = this.#db.prepare("INSERT OR REPLACE INTO embeddings (chunk_rowid, source_id, embedding) VALUES (?, ?, ?)");
        const tx = this.#db.transaction(() => {
            for (let i = 0; i < rowids.length; i++) {
                const buf = Buffer.from(embeddings[i].buffer);
                insert.run(rowids[i].rowid, sourceId, buf);
            }
        });
        tx();
        return embeddings.length;
    }
    /**
     * Vector search: find chunks most similar to a query embedding.
     * Brute-force cosine similarity (fast enough for <10K chunks).
     */
    searchVector(queryEmbedding, limit = 3, source) {
        let rows;
        if (source) {
            rows = this.#db.prepare(`
        SELECT e.chunk_rowid, e.source_id, e.embedding
        FROM embeddings e
        JOIN sources s ON s.id = e.source_id
        WHERE s.label LIKE ?
      `).all(`%${source}%`);
        }
        else {
            rows = this.#db.prepare("SELECT chunk_rowid, source_id, embedding FROM embeddings").all();
        }
        if (rows.length === 0)
            return [];
        // Score each embedding by cosine similarity
        const scored = rows.map(row => {
            const vec = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
            return { rowid: row.chunk_rowid, score: cosineSimilarity(queryEmbedding, vec) };
        });
        // Sort by similarity descending, take top-k
        scored.sort((a, b) => b.score - a.score);
        const topK = scored.slice(0, limit);
        // Fetch chunk content for the top results
        const results = [];
        for (const { rowid, score } of topK) {
            const chunk = this.#db.prepare(`
        SELECT c.title, c.content, c.content_type, s.label
        FROM chunks c
        JOIN sources s ON s.id = c.source_id
        WHERE c.rowid = ?
      `).get(rowid);
            if (chunk) {
                results.push({
                    title: chunk.title,
                    content: chunk.content,
                    source: chunk.label,
                    rank: -score, // negative so higher similarity = better (consistent with BM25)
                    contentType: chunk.content_type,
                    highlighted: chunk.content,
                });
            }
        }
        return results;
    }
    /**
     * Hybrid search: combine BM25 and vector results using Reciprocal Rank Fusion.
     * Falls back to BM25-only if no embeddings are available.
     */
    searchHybrid(bm25Results, vectorResults, limit = 3) {
        const k = 60; // RRF constant
        const scoreMap = new Map();
        // Score BM25 results
        for (let i = 0; i < bm25Results.length; i++) {
            const key = `${bm25Results[i].source}:${bm25Results[i].title}`;
            const rrfScore = 1 / (k + i + 1);
            const existing = scoreMap.get(key);
            if (existing) {
                existing.score += rrfScore;
            }
            else {
                scoreMap.set(key, { score: rrfScore, result: bm25Results[i] });
            }
        }
        // Score vector results
        for (let i = 0; i < vectorResults.length; i++) {
            const key = `${vectorResults[i].source}:${vectorResults[i].title}`;
            const rrfScore = 1 / (k + i + 1);
            const existing = scoreMap.get(key);
            if (existing) {
                existing.score += rrfScore;
            }
            else {
                scoreMap.set(key, { score: rrfScore, result: vectorResults[i] });
            }
        }
        // Sort by combined RRF score, take top-k
        return Array.from(scoreMap.values())
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(entry => entry.result);
    }
    /**
     * Check if any embeddings exist in the database.
     */
    hasEmbeddings() {
        const row = this.#db.prepare("SELECT COUNT(*) as cnt FROM embeddings").get();
        return row.cnt > 0;
    }
    // ── Sources ──
    listSources() {
        return this.#stmtListSources.all();
    }
    /**
     * Get all chunks for a given source by ID — bypasses FTS5 MATCH entirely.
     * Use this for inventory/listing where you need all sections, not search.
     */
    getChunksBySource(sourceId) {
        const rows = this.#stmtChunksBySource.all(sourceId);
        return rows.map((r) => ({
            title: r.title,
            content: r.content,
            source: r.label,
            rank: 0,
            contentType: r.content_type,
        }));
    }
    // ── Vocabulary ──
    getDistinctiveTerms(sourceId, maxTerms = 40) {
        const stats = this.#stmtSourceChunkCount.get(sourceId);
        if (!stats || stats.chunk_count < 3)
            return [];
        const totalChunks = stats.chunk_count;
        const minAppearances = 2;
        const maxAppearances = Math.max(3, Math.ceil(totalChunks * 0.4));
        // Stream chunks one at a time to avoid loading all content into memory
        // Count document frequency (how many sections contain each word)
        const docFreq = new Map();
        for (const row of this.#stmtChunkContent.iterate(sourceId)) {
            const words = new Set(row.content
                .toLowerCase()
                .split(/[^\p{L}\p{N}_-]+/u)
                .filter((w) => w.length >= 3 && !STOPWORDS.has(w)));
            for (const word of words) {
                docFreq.set(word, (docFreq.get(word) ?? 0) + 1);
            }
        }
        const filtered = Array.from(docFreq.entries())
            .filter(([, count]) => count >= minAppearances && count <= maxAppearances);
        // Score: IDF (rarity) + length bonus + identifier bonus (underscore/camelCase)
        const scored = filtered.map(([word, count]) => {
            const idf = Math.log(totalChunks / count);
            const lenBonus = Math.min(word.length / 20, 0.5);
            const hasSpecialChars = /[_]/.test(word);
            const isCamelOrLong = word.length >= 12;
            const identifierBonus = hasSpecialChars ? 1.5 : isCamelOrLong ? 0.8 : 0;
            return { word, score: idf + lenBonus + identifierBonus };
        });
        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, maxTerms)
            .map((s) => s.word);
    }
    // ── Stats ──
    getStats() {
        const row = this.#stmtStats.get();
        return {
            sources: row?.sources ?? 0,
            chunks: row?.chunks ?? 0,
            codeChunks: row?.codeChunks ?? 0,
        };
    }
    // ── Cleanup ──
    close() {
        this.#db.close();
    }
    // ── Vocabulary Extraction ──
    #extractAndStoreVocabulary(content) {
        const words = content
            .toLowerCase()
            .split(/[^\p{L}\p{N}_-]+/u)
            .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
        const unique = [...new Set(words)];
        this.#db.transaction(() => {
            for (const word of unique) {
                this.#stmtInsertVocab.run(word);
            }
        })();
    }
    // ── Chunking ──
    #chunkMarkdown(text, maxChunkBytes = MAX_CHUNK_BYTES) {
        const chunks = [];
        const lines = text.split("\n");
        const headingStack = [];
        let currentContent = [];
        let currentHeading = "";
        const flush = () => {
            const joined = currentContent.join("\n").trim();
            if (joined.length === 0)
                return;
            const title = this.#buildTitle(headingStack, currentHeading);
            const hasCode = currentContent.some((l) => /^`{3,}/.test(l));
            // If under the cap, emit as-is (fast path — most chunks hit this)
            if (Buffer.byteLength(joined) <= maxChunkBytes) {
                chunks.push({ title, content: joined, hasCode });
                currentContent = [];
                return;
            }
            // Split oversized chunk at paragraph boundaries (double newlines)
            const paragraphs = joined.split(/\n\n+/);
            let accumulator = [];
            let partIndex = 1;
            const flushAccumulator = () => {
                if (accumulator.length === 0)
                    return;
                const part = accumulator.join("\n\n").trim();
                if (part.length === 0)
                    return;
                const partTitle = paragraphs.length > 1 ? `${title} (${partIndex})` : title;
                partIndex++;
                chunks.push({
                    title: partTitle,
                    content: part,
                    hasCode: part.includes("```"),
                });
                accumulator = [];
            };
            for (const para of paragraphs) {
                accumulator.push(para);
                const candidate = accumulator.join("\n\n");
                if (Buffer.byteLength(candidate) > maxChunkBytes && accumulator.length > 1) {
                    accumulator.pop();
                    flushAccumulator();
                    accumulator = [para];
                }
            }
            flushAccumulator();
            currentContent = [];
        };
        let i = 0;
        while (i < lines.length) {
            const line = lines[i];
            // Horizontal rule separator (Context7 uses long dashes)
            if (/^[-_*]{3,}\s*$/.test(line)) {
                flush();
                i++;
                continue;
            }
            // Heading (H1-H4)
            const headingMatch = line.match(/^(#{1,4})\s+(.+)$/);
            if (headingMatch) {
                flush();
                const level = headingMatch[1].length;
                const heading = headingMatch[2].trim();
                // Pop deeper levels from stack
                while (headingStack.length > 0 &&
                    headingStack[headingStack.length - 1].level >= level) {
                    headingStack.pop();
                }
                headingStack.push({ level, text: heading });
                currentHeading = heading;
                currentContent.push(line);
                i++;
                continue;
            }
            // Code block — collect entire block as a unit
            const codeMatch = line.match(/^(`{3,})(.*)?$/);
            if (codeMatch) {
                const fence = codeMatch[1];
                const codeLines = [line];
                i++;
                while (i < lines.length) {
                    codeLines.push(lines[i]);
                    if (lines[i].startsWith(fence) && lines[i].trim() === fence) {
                        i++;
                        break;
                    }
                    i++;
                }
                currentContent.push(...codeLines);
                continue;
            }
            // Regular line
            currentContent.push(line);
            i++;
        }
        // Flush remaining content
        flush();
        return chunks;
    }
    #chunkPlainText(text, linesPerChunk) {
        // Try blank-line splitting first for naturally-sectioned output
        const sections = text.split(/\n\s*\n/);
        if (sections.length >= 3 &&
            sections.length <= 200 &&
            sections.every((s) => Buffer.byteLength(s) < 5000)) {
            return sections
                .map((section, i) => {
                const trimmed = section.trim();
                const firstLine = trimmed.split("\n")[0].slice(0, 80);
                return {
                    title: firstLine || `Section ${i + 1}`,
                    content: trimmed,
                };
            })
                .filter((s) => s.content.length > 0);
        }
        const lines = text.split("\n");
        // Small enough for a single chunk
        if (lines.length <= linesPerChunk) {
            return [{ title: "Output", content: text }];
        }
        // Fixed-size line groups with 2-line overlap
        const chunks = [];
        const overlap = 2;
        const step = Math.max(linesPerChunk - overlap, 1);
        for (let i = 0; i < lines.length; i += step) {
            const slice = lines.slice(i, i + linesPerChunk);
            if (slice.length === 0)
                break;
            const startLine = i + 1;
            const endLine = Math.min(i + slice.length, lines.length);
            const firstLine = slice[0]?.trim().slice(0, 80);
            chunks.push({
                title: firstLine || `Lines ${startLine}-${endLine}`,
                content: slice.join("\n"),
            });
        }
        return chunks;
    }
    #walkJSON(value, path, chunks, maxChunkBytes) {
        const title = path.length > 0 ? path.join(" > ") : "(root)";
        const serialized = JSON.stringify(value, null, 2);
        // Small enough — emit as a single chunk
        if (Buffer.byteLength(serialized) <= maxChunkBytes) {
            // Exception: objects with nested structure (object/array values) always
            // recurse so that key paths become chunk titles for searchability —
            // even when the subtree fits in one chunk. Flat objects (all primitive
            // values) stay as a single chunk since there's no hierarchy to expose.
            const shouldRecurse = typeof value === "object" &&
                value !== null &&
                !Array.isArray(value) &&
                Object.values(value).some((v) => typeof v === "object" && v !== null);
            if (!shouldRecurse) {
                chunks.push({ title, content: serialized, hasCode: true });
                return;
            }
        }
        // Object — recurse into each key
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            const entries = Object.entries(value);
            if (entries.length > 0) {
                for (const [key, val] of entries) {
                    this.#walkJSON(val, [...path, key], chunks, maxChunkBytes);
                }
                return;
            }
            // Empty object — emit as-is
            chunks.push({ title, content: serialized, hasCode: true });
            return;
        }
        // Array — batch by size with identity-field-aware titles
        if (Array.isArray(value)) {
            this.#chunkJSONArray(value, path, chunks, maxChunkBytes);
            return;
        }
        // Primitive that exceeds maxChunkBytes (e.g., very long string)
        chunks.push({ title, content: serialized, hasCode: false });
    }
    /**
     * Scan the first element of an array of objects for a recognizable
     * identity field. Returns the field name or null.
     */
    #findIdentityField(arr) {
        if (arr.length === 0)
            return null;
        const first = arr[0];
        if (typeof first !== "object" || first === null || Array.isArray(first))
            return null;
        const candidates = ["id", "name", "title", "path", "slug", "key", "label"];
        const obj = first;
        for (const field of candidates) {
            if (field in obj && (typeof obj[field] === "string" || typeof obj[field] === "number")) {
                return field;
            }
        }
        return null;
    }
    #jsonBatchTitle(prefix, startIdx, endIdx, batch, identityField) {
        const sep = prefix ? `${prefix} > ` : "";
        if (!identityField) {
            return startIdx === endIdx
                ? `${sep}[${startIdx}]`
                : `${sep}[${startIdx}-${endIdx}]`;
        }
        const getId = (item) => String(item[identityField]);
        if (batch.length === 1) {
            return `${sep}${getId(batch[0])}`;
        }
        if (batch.length <= 3) {
            return sep + batch.map(getId).join(", ");
        }
        return `${sep}${getId(batch[0])}\u2026${getId(batch[batch.length - 1])}`;
    }
    #chunkJSONArray(arr, path, chunks, maxChunkBytes) {
        const prefix = path.length > 0 ? path.join(" > ") : "(root)";
        const identityField = this.#findIdentityField(arr);
        let batch = [];
        let batchStart = 0;
        const flushBatch = (batchEnd) => {
            if (batch.length === 0)
                return;
            const title = this.#jsonBatchTitle(prefix, batchStart, batchEnd, batch, identityField);
            chunks.push({
                title,
                content: JSON.stringify(batch, null, 2),
                hasCode: true,
            });
        };
        for (let i = 0; i < arr.length; i++) {
            batch.push(arr[i]);
            const candidate = JSON.stringify(batch, null, 2);
            if (Buffer.byteLength(candidate) > maxChunkBytes && batch.length > 1) {
                batch.pop();
                flushBatch(i - 1);
                batch = [arr[i]];
                batchStart = i;
            }
        }
        // Flush remaining
        flushBatch(batchStart + batch.length - 1);
    }
    #buildTitle(headingStack, currentHeading) {
        if (headingStack.length === 0) {
            return currentHeading || "Untitled";
        }
        return headingStack.map((h) => h.text).join(" > ");
    }
}

/**
 * Code chunker using web-tree-sitter for language-aware semantic chunking.
 * Parses source code into AST and extracts meaningful units.
 */
interface Chunk {
    title: string;
    content: string;
    hasCode: boolean;
}
/**
 * Parse source code and extract semantic chunks.
 * Returns an array of Chunk objects for FTS5 indexing.
 */
export declare function chunkCode(source: string, language: string): Promise<Chunk[]>;
/**
 * Detect language from file extension.
 * Returns null if the extension is not recognized as a code file.
 */
export declare function detectLanguage(filePath: string): string | null;
/**
 * Check if a file path is a supported code file.
 */
export declare function isCodeFile(filePath: string): boolean;
export {};

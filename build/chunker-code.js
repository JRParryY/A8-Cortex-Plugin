/**
 * Code chunker using web-tree-sitter for language-aware semantic chunking.
 * Parses source code into AST and extracts meaningful units.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Lazy-loaded tree-sitter module
let Parser = null;
let Language = null;
const languageParsers = new Map();
// Extension to language mapping
const EXT_MAP = {
    ".ts": "typescript",
    ".tsx": "typescript",
    ".js": "javascript",
    ".jsx": "javascript",
    ".mjs": "javascript",
    ".py": "python",
    ".go": "go",
    ".rs": "rust",
    ".dart": "dart",
};
// AST node types that represent top-level declarations per language
const DECLARATION_TYPES = {
    typescript: [
        "function_declaration",
        "class_declaration",
        "interface_declaration",
        "type_alias_declaration",
        "enum_declaration",
        "export_statement",
        "lexical_declaration", // const/let at top level
    ],
    javascript: [
        "function_declaration",
        "class_declaration",
        "export_statement",
        "lexical_declaration",
        "variable_declaration",
    ],
    python: [
        "function_definition",
        "class_definition",
        "decorated_definition",
    ],
    go: [
        "function_declaration",
        "method_declaration",
        "type_declaration",
        "const_declaration",
        "var_declaration",
    ],
    rust: [
        "function_item",
        "struct_item",
        "enum_item",
        "impl_item",
        "trait_item",
        "type_item",
        "const_item",
    ],
    dart: [
        "function_signature",
        "class_definition",
        "enum_declaration",
        "type_alias",
        "mixin_declaration",
        "extension_declaration",
    ],
};
async function initParser() {
    if (Parser)
        return;
    const mod = await import("web-tree-sitter");
    // web-tree-sitter: Parser and Language are separate top-level exports
    const ParserClass = mod.Parser ?? mod.default?.Parser ?? mod.default;
    const LanguageClass = mod.Language ?? mod.default?.Language;
    if (!ParserClass?.init) {
        throw new Error("Could not find tree-sitter Parser.init()");
    }
    await ParserClass.init();
    Parser = ParserClass;
    Language = LanguageClass;
}
async function getLanguageParser(language) {
    if (languageParsers.has(language))
        return languageParsers.get(language);
    await initParser();
    // Look for grammar WASM files in their respective npm packages
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const projectRoot = resolve(__dirname, "..");
    const { existsSync } = await import("node:fs");
    const wasmCandidates = [
        resolve(projectRoot, "node_modules", `tree-sitter-${language}`, `tree-sitter-${language}.wasm`),
        resolve(projectRoot, "node_modules", "tree-sitter-wasms", "out", `tree-sitter-${language}.wasm`),
    ];
    const wasmPath = wasmCandidates.find(p => existsSync(p));
    if (!wasmPath)
        throw new Error(`No WASM grammar found for ${language}`);
    const lang = await Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(lang);
    languageParsers.set(language, parser);
    return parser;
}
/**
 * Extract a readable name from an AST node.
 */
function extractName(node, language) {
    // Try named children for identifier
    for (const child of node.namedChildren) {
        if (child.type === "identifier" ||
            child.type === "name" ||
            child.type === "property_identifier" ||
            child.type === "type_identifier") {
            return child.text;
        }
    }
    // For export statements, recurse into the declaration
    if (node.type === "export_statement" || node.type === "decorated_definition") {
        for (const child of node.namedChildren) {
            const name = extractName(child, language);
            if (name !== "unknown")
                return name;
        }
    }
    // Fallback: first 40 chars of text
    const text = node.text.slice(0, 40).replace(/\n/g, " ").trim();
    return text || "unknown";
}
/**
 * Get a human-readable type label for a node type.
 */
function getTypeLabel(nodeType) {
    const map = {
        function_declaration: "function",
        function_definition: "function",
        function_item: "function",
        function_signature: "function",
        method_declaration: "method",
        class_declaration: "class",
        class_definition: "class",
        interface_declaration: "interface",
        type_alias_declaration: "type",
        type_alias: "type",
        type_declaration: "type",
        type_item: "type",
        enum_declaration: "enum",
        enum_item: "enum",
        struct_item: "struct",
        impl_item: "impl",
        trait_item: "trait",
        const_declaration: "const",
        const_item: "const",
        var_declaration: "var",
        lexical_declaration: "const",
        variable_declaration: "var",
        export_statement: "export",
        decorated_definition: "decorated",
        mixin_declaration: "mixin",
        extension_declaration: "extension",
    };
    return map[nodeType] ?? nodeType;
}
/**
 * Parse source code and extract semantic chunks.
 * Returns an array of Chunk objects for FTS5 indexing.
 */
export async function chunkCode(source, language) {
    const parser = await getLanguageParser(language);
    const tree = parser.parse(source);
    const root = tree.rootNode;
    const declTypes = DECLARATION_TYPES[language];
    if (!declTypes)
        return fallbackChunk(source, language);
    const chunks = [];
    const usedRanges = [];
    // Walk top-level children
    for (const node of root.namedChildren) {
        if (declTypes.includes(node.type)) {
            const name = extractName(node, language);
            const label = getTypeLabel(node.type);
            const title = `${label}: ${name}`;
            const content = node.text;
            chunks.push({ title, content, hasCode: true });
            usedRanges.push([node.startIndex, node.endIndex]);
        }
    }
    // Collect any remaining top-level code (imports, comments, etc.)
    const sourceText = root.text;
    let remaining = "";
    let lastEnd = 0;
    for (const [start, end] of usedRanges.sort((a, b) => a[0] - b[0])) {
        if (start > lastEnd) {
            const gap = sourceText.slice(lastEnd, start).trim();
            if (gap)
                remaining += gap + "\n";
        }
        lastEnd = end;
    }
    if (lastEnd < sourceText.length) {
        const tail = sourceText.slice(lastEnd).trim();
        if (tail)
            remaining += tail;
    }
    if (remaining.trim()) {
        chunks.unshift({ title: "imports/header", content: remaining.trim(), hasCode: true });
    }
    // If we got no meaningful chunks, fall back
    if (chunks.length <= 1)
        return fallbackChunk(source, language);
    return chunks;
}
function fallbackChunk(source, language) {
    // Simple line-based chunking as fallback
    const lines = source.split("\n");
    const chunkSize = 50;
    const chunks = [];
    for (let i = 0; i < lines.length; i += chunkSize) {
        const slice = lines.slice(i, i + chunkSize).join("\n");
        chunks.push({
            title: `${language}:${i + 1}-${Math.min(i + chunkSize, lines.length)}`,
            content: slice,
            hasCode: true,
        });
    }
    return chunks.length > 0 ? chunks : [{ title: language, content: source, hasCode: true }];
}
/**
 * Detect language from file extension.
 * Returns null if the extension is not recognized as a code file.
 */
export function detectLanguage(filePath) {
    const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
    return EXT_MAP[ext] ?? null;
}
/**
 * Check if a file path is a supported code file.
 */
export function isCodeFile(filePath) {
    return detectLanguage(filePath) !== null;
}

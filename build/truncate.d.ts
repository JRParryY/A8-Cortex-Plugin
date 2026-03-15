/**
 * truncate — Pure string and output truncation utilities for context-mode.
 *
 * These helpers are used by both the core ContentStore (chunking) and the
 * PolyglotExecutor (smart output truncation). They are extracted here so
 * SessionDB and any other future consumer can import them without pulling
 * in the full store or executor.
 */
/**
 * Truncate a string to at most `maxChars` characters, appending an ellipsis
 * when truncation occurs.
 *
 * @param str     - Input string.
 * @param maxChars - Maximum character count (inclusive). Must be >= 3.
 * @returns The original string if short enough, otherwise a truncated string
 *          ending with "...".
 */
export declare function truncateString(str: string, maxChars: number): string;
/**
 * Smart truncation that keeps the head (60%) and tail (40%) of output,
 * preserving both initial context and final error messages.
 * Snaps to line boundaries and handles UTF-8 safely via `Buffer.byteLength`.
 *
 * Used by PolyglotExecutor to cap stdout/stderr before returning to context.
 *
 * @param raw - Raw output string.
 * @param maxBytes - Soft cap in bytes. Output below this threshold is returned as-is.
 * @returns The original string if within budget, otherwise head + separator + tail.
 */
export declare function smartTruncate(raw: string, maxBytes: number): string;
/**
 * Serialize a value to JSON, then truncate the result to `maxBytes` bytes.
 * If truncation occurs, the string is cut at a UTF-8-safe boundary and
 * "... [truncated]" is appended. The result is NOT guaranteed to be valid
 * JSON after truncation — it is suitable only for display/logging.
 *
 * @param value    - Any JSON-serializable value.
 * @param maxBytes - Maximum byte length of the returned string.
 * @param indent   - JSON indentation spaces (default 2). Pass 0 for compact.
 */
export declare function truncateJSON(value: unknown, maxBytes: number, indent?: number): string;
/**
 * Escape a string for safe embedding in an XML or HTML attribute or text node.
 * Replaces the five XML-reserved characters: `&`, `<`, `>`, `"`, `'`.
 *
 * Used by the resume snapshot template builder to embed user content in
 * `<tool_response>` and `<user_message>` XML tags without breaking the
 * structured prompt format.
 */
export declare function escapeXML(str: string): string;
/**
 * Return `str` unchanged if it fits within `maxBytes`, otherwise return a
 * byte-safe slice with an ellipsis appended. Useful for single-value fields
 * (e.g., tool response strings) where head+tail splitting is not needed.
 *
 * @param str      - Input string.
 * @param maxBytes - Hard byte cap.
 */
export declare function capBytes(str: string, maxBytes: number): string;

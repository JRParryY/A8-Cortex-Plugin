#!/usr/bin/env node
/**
 * Parse FTS5 highlight markers to find match positions in the
 * original (marker-free) text. Returns character offsets into the
 * stripped content where each matched token begins.
 */
export declare function positionsFromHighlight(highlighted: string): number[];
export declare function extractSnippet(content: string, query: string, maxLen?: number, highlighted?: string): string;

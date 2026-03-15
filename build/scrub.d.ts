/**
 * Credential scrubbing — defense-in-depth for session snapshots.
 * Strips secrets, API keys, tokens, and connection strings from text
 * before it enters session state or context.
 */
export declare function scrubSecrets(text: string): string;

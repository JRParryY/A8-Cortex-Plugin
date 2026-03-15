/**
 * Credential scrubbing — defense-in-depth for session snapshots.
 * Strips secrets, API keys, tokens, and connection strings from text
 * before it enters session state or context.
 */
const SECRET_PATTERNS = [
    /(?:password|passwd|pwd)\s*[=:]\s*\S+/gi,
    /(?:token|api[_-]?key|secret|auth)\s*[=:]\s*\S+/gi,
    /sk-[a-zA-Z0-9]{20,}/g, // OpenAI keys
    /sk-ant-[a-zA-Z0-9-]{20,}/g, // Anthropic keys
    /sk-or-[a-zA-Z0-9-]{20,}/g, // OpenRouter keys
    /eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_-]{20,}/g, // JWTs
    /postgres:\/\/[^@\s]+@/g, // DB connection strings
    /mongodb(\+srv)?:\/\/[^@\s]+@/g,
    /redis:\/\/[^@\s]+@/g,
    /PGPASSWORD\s*=\s*['"][^'"]+['"]/gi,
    /supabase[a-zA-Z_]*\s*[=:]\s*\S{10,}/gi,
];
export function scrubSecrets(text) {
    let result = text;
    for (const pattern of SECRET_PATTERNS) {
        pattern.lastIndex = 0;
        result = result.replace(pattern, (match) => {
            const eqIdx = match.search(/[=:]/);
            if (eqIdx >= 0)
                return match.slice(0, eqIdx + 1) + " [REDACTED]";
            return "[REDACTED]";
        });
    }
    return result;
}

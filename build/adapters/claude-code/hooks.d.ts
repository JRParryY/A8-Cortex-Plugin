/**
 * adapters/claude-code/hooks — Claude Code hook definitions and matchers.
 *
 * Defines the hook types, matchers, and registration format specific to
 * Claude Code's hook system. This module is used by:
 *   - CLI setup/upgrade commands (to configure hooks in settings.json)
 *   - Doctor command (to validate hook configuration)
 *   - hooks.json generation
 *
 * Claude Code hook system reference:
 *   - Hooks are registered in ~/.claude/settings.json under "hooks" key
 *   - Each hook type maps to an array of { matcher, hooks } entries
 *   - matcher: tool name pattern (empty = match all tools)
 *   - hooks: array of { type: "command", command: "..." }
 *   - Input: JSON on stdin
 *   - Output: JSON on stdout (or empty for passthrough)
 */
/** Claude Code hook types. */
export declare const HOOK_TYPES: {
    readonly PRE_TOOL_USE: "PreToolUse";
    readonly POST_TOOL_USE: "PostToolUse";
    readonly PRE_COMPACT: "PreCompact";
    readonly SESSION_START: "SessionStart";
    readonly USER_PROMPT_SUBMIT: "UserPromptSubmit";
};
export type HookType = (typeof HOOK_TYPES)[keyof typeof HOOK_TYPES];
/** Tools that a8-cortex's PreToolUse hook intercepts. */
export declare const PRE_TOOL_USE_MATCHERS: readonly ["Bash", "WebFetch", "Read", "Grep", "Agent", "Task", "mcp__plugin_a8-cortex_a8-cortex__cm_execute", "mcp__plugin_a8-cortex_a8-cortex__cm_execute_file", "mcp__plugin_a8-cortex_a8-cortex__cm_batch_execute"];
/**
 * Combined matcher pattern for settings.json (pipe-separated).
 * Used by the upgrade command when writing a single consolidated entry.
 */
export declare const PRE_TOOL_USE_MATCHER_PATTERN: string;
/** Map of hook types to their script file names. */
export declare const HOOK_SCRIPTS: Record<HookType, string>;
/** Required hooks that must be configured for a8-cortex to function. */
export declare const REQUIRED_HOOKS: HookType[];
/** Optional hooks that enhance functionality but aren't critical. */
export declare const OPTIONAL_HOOKS: HookType[];
/**
 * Check if a hook entry points to an a8-cortex hook script.
 * Matches both legacy format (node .../pretooluse.mjs) and
 * CLI dispatcher format (a8-cortex hook claude-code pretooluse).
 */
export declare function isContextModeHook(entry: {
    hooks?: Array<{
        command?: string;
    }>;
}, hookType: HookType): boolean;
/**
 * Build the hook command string for a given hook type.
 * Uses absolute node path to avoid PATH issues (homebrew, nvm, volta, etc.).
 * Falls back to CLI dispatcher if pluginRoot is not provided.
 */
export declare function buildHookCommand(hookType: HookType, pluginRoot?: string): string;

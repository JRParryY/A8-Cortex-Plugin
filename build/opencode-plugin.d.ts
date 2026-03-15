/**
 * OpenCode TypeScript plugin entry point for context-mode.
 *
 * Provides three hooks:
 *   - tool.execute.before  — Routing enforcement (deny/modify/passthrough)
 *   - tool.execute.after   — Session event capture
 *   - experimental.session.compacting — Compaction snapshot generation
 *
 * Loaded by OpenCode via: import("context-mode/plugin").ContextModePlugin(ctx)
 *
 * Constraints:
 *   - No SessionStart hook (OpenCode doesn't support it — #14808, #5409)
 *   - No context injection (canInjectSessionContext: false)
 *   - Session cleanup happens at plugin init (no SessionStart)
 */
/** OpenCode plugin context passed to the factory function. */
interface PluginContext {
    directory: string;
}
/** Shape of the input object OpenCode passes to hook functions. */
interface ToolHookInput {
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_output?: string;
    is_error?: boolean;
    sessionID?: string;
}
/**
 * OpenCode plugin factory. Called once when OpenCode loads the plugin.
 * Returns an object mapping hook event names to async handler functions.
 */
export declare const ContextModePlugin: (ctx: PluginContext) => Promise<{
    "tool.execute.before": (input: ToolHookInput) => Promise<void>;
    "tool.execute.after": (input: ToolHookInput) => Promise<void>;
    "experimental.session.compacting": () => Promise<string>;
}>;
export {};

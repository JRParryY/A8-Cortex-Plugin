/**
 * adapters/opencode — OpenCode platform adapter.
 *
 * Implements HookAdapter for OpenCode's TypeScript plugin paradigm.
 *
 * OpenCode hook specifics:
 *   - I/O: TS plugin functions (not JSON stdin/stdout)
 *   - Hook names: tool.execute.before, tool.execute.after, experimental.session.compacting
 *   - Arg modification: output.args mutation
 *   - Blocking: throw Error in tool.execute.before
 *   - Output modification: output.output mutation (TUI bug for bash #13575)
 *   - SessionStart: broken (#14808, no hook #5409)
 *   - Session ID: input.sessionID (camelCase!)
 *   - Project dir: ctx.directory in plugin init (no env var)
 *   - Config: opencode.json plugin array, .opencode/plugins/*.ts
 *   - Session dir: ~/.config/opencode/context-mode/sessions/
 */
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration, RoutingInstructionsConfig } from "../types.js";
export declare class OpenCodeAdapter implements HookAdapter {
    readonly name = "OpenCode";
    readonly paradigm: HookParadigm;
    readonly capabilities: PlatformCapabilities;
    parsePreToolUseInput(raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(raw: unknown): PostToolUseEvent;
    parsePreCompactInput(raw: unknown): PreCompactEvent;
    parseSessionStartInput(raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(response: PostToolUseResponse): unknown;
    formatPreCompactResponse(response: PreCompactResponse): unknown;
    formatSessionStartResponse(response: SessionStartResponse): unknown;
    getSettingsPath(): string;
    getSessionDir(): string;
    getSessionDBPath(projectDir: string): string;
    getSessionEventsPath(projectDir: string): string;
    generateHookConfig(_pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(settings: Record<string, unknown>): void;
    validateHooks(_pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(_pluginRoot: string): string[];
    backupSettings(): string | null;
    setHookPermissions(_pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    getRoutingInstructionsConfig(): RoutingInstructionsConfig;
    writeRoutingInstructions(projectDir: string, pluginRoot: string): string | null;
    /**
     * Extract session ID from OpenCode hook input.
     * OpenCode uses camelCase sessionID.
     */
    private extractSessionId;
}

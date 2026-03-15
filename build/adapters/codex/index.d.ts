/**
 * adapters/codex — Codex CLI platform adapter.
 *
 * Implements HookAdapter for Codex CLI's MCP-only paradigm.
 *
 * Codex CLI hook specifics:
 *   - NO hook support (PRs #2904, #9796 were closed without merge)
 *   - Only "hook": notify config for agent-turn-complete (very limited)
 *   - Config: ~/.codex/config.toml (TOML format, not JSON)
 *   - MCP: full support via [mcp_servers] in config.toml
 *   - All capabilities are false — MCP is the only integration path
 *   - Session dir: ~/.codex/context-mode/sessions/
 */
import type { HookAdapter, HookParadigm, PlatformCapabilities, DiagnosticResult, PreToolUseEvent, PostToolUseEvent, PreCompactEvent, SessionStartEvent, PreToolUseResponse, PostToolUseResponse, PreCompactResponse, SessionStartResponse, HookRegistration, RoutingInstructionsConfig } from "../types.js";
export declare class CodexAdapter implements HookAdapter {
    readonly name = "Codex CLI";
    readonly paradigm: HookParadigm;
    readonly capabilities: PlatformCapabilities;
    parsePreToolUseInput(_raw: unknown): PreToolUseEvent;
    parsePostToolUseInput(_raw: unknown): PostToolUseEvent;
    parsePreCompactInput(_raw: unknown): PreCompactEvent;
    parseSessionStartInput(_raw: unknown): SessionStartEvent;
    formatPreToolUseResponse(_response: PreToolUseResponse): unknown;
    formatPostToolUseResponse(_response: PostToolUseResponse): unknown;
    formatPreCompactResponse(_response: PreCompactResponse): unknown;
    formatSessionStartResponse(_response: SessionStartResponse): unknown;
    getSettingsPath(): string;
    getSessionDir(): string;
    getSessionDBPath(projectDir: string): string;
    getSessionEventsPath(projectDir: string): string;
    generateHookConfig(_pluginRoot: string): HookRegistration;
    readSettings(): Record<string, unknown> | null;
    writeSettings(_settings: Record<string, unknown>): void;
    validateHooks(_pluginRoot: string): DiagnosticResult[];
    checkPluginRegistration(): DiagnosticResult;
    getInstalledVersion(): string;
    configureAllHooks(_pluginRoot: string): string[];
    backupSettings(): string | null;
    setHookPermissions(_pluginRoot: string): string[];
    updatePluginRegistry(_pluginRoot: string, _version: string): void;
    getRoutingInstructionsConfig(): RoutingInstructionsConfig;
    writeRoutingInstructions(projectDir: string, pluginRoot: string): string | null;
    getRoutingInstructions(): string;
}

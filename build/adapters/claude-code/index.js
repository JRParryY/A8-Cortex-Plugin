/**
 * adapters/claude-code — Claude Code platform adapter.
 *
 * Implements HookAdapter for Claude Code's JSON stdin/stdout hook paradigm.
 *
 * Claude Code hook specifics:
 *   - I/O: JSON on stdin, JSON on stdout
 *   - Arg modification: `updatedInput` field in response
 *   - Blocking: `permissionDecision: "deny"` in response
 *   - PostToolUse output: `updatedMCPToolOutput` field
 *   - PreCompact: stdout on exit 0
 *   - Session ID: transcript_path UUID > session_id > CLAUDE_SESSION_ID > ppid
 *   - Config: ~/.claude/settings.json
 *   - Session dir: ~/.claude/a8-cortex/sessions/
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, accessSync, readdirSync, chmodSync, constants, } from "node:fs";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { HOOK_TYPES, HOOK_SCRIPTS, PRE_TOOL_USE_MATCHER_PATTERN, isContextModeHook, buildHookCommand, } from "./hooks.js";
// ─────────────────────────────────────────────────────────
// Adapter implementation
// ─────────────────────────────────────────────────────────
export class ClaudeCodeAdapter {
    name = "Claude Code";
    paradigm = "json-stdio";
    capabilities = {
        preToolUse: true,
        postToolUse: true,
        preCompact: true,
        sessionStart: true,
        canModifyArgs: true,
        canModifyOutput: true,
        canInjectSessionContext: true,
    };
    // ── Input parsing ──────────────────────────────────────
    parsePreToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.tool_name ?? "",
            toolInput: input.tool_input ?? {},
            sessionId: this.extractSessionId(input),
            projectDir: process.env.CLAUDE_PROJECT_DIR,
            raw,
        };
    }
    parsePostToolUseInput(raw) {
        const input = raw;
        return {
            toolName: input.tool_name ?? "",
            toolInput: input.tool_input ?? {},
            toolOutput: input.tool_output,
            isError: input.is_error,
            sessionId: this.extractSessionId(input),
            projectDir: process.env.CLAUDE_PROJECT_DIR,
            raw,
        };
    }
    parsePreCompactInput(raw) {
        const input = raw;
        return {
            sessionId: this.extractSessionId(input),
            projectDir: process.env.CLAUDE_PROJECT_DIR,
            raw,
        };
    }
    parseSessionStartInput(raw) {
        const input = raw;
        const rawSource = input.source ?? "startup";
        let source;
        switch (rawSource) {
            case "compact":
                source = "compact";
                break;
            case "resume":
                source = "resume";
                break;
            case "clear":
                source = "clear";
                break;
            default:
                source = "startup";
        }
        return {
            sessionId: this.extractSessionId(input),
            source,
            projectDir: process.env.CLAUDE_PROJECT_DIR,
            raw,
        };
    }
    // ── Response formatting ────────────────────────────────
    formatPreToolUseResponse(response) {
        if (response.decision === "deny") {
            return {
                permissionDecision: "deny",
                reason: response.reason ?? "Blocked by A8-Cortex hook",
            };
        }
        if (response.decision === "modify" && response.updatedInput) {
            return { updatedInput: response.updatedInput };
        }
        if (response.decision === "context" && response.additionalContext) {
            // Claude Code: inject additionalContext into model context
            return { additionalContext: response.additionalContext };
        }
        if (response.decision === "ask") {
            // Claude Code: native "ask" — prompt user for permission
            return { permissionDecision: "ask" };
        }
        // "allow" — return null/undefined for passthrough
        return undefined;
    }
    formatPostToolUseResponse(response) {
        const result = {};
        if (response.additionalContext) {
            result.additionalContext = response.additionalContext;
        }
        if (response.updatedOutput) {
            result.updatedMCPToolOutput = response.updatedOutput;
        }
        return Object.keys(result).length > 0 ? result : undefined;
    }
    formatPreCompactResponse(response) {
        // Claude Code: stdout content on exit 0 is injected as context
        return response.context ?? "";
    }
    formatSessionStartResponse(response) {
        // Claude Code: stdout content is injected as additional context
        return response.context ?? "";
    }
    // ── Configuration ──────────────────────────────────────
    getSettingsPath() {
        return resolve(homedir(), ".claude", "settings.json");
    }
    getSessionDir() {
        const dir = join(homedir(), ".claude", "a8-cortex", "sessions");
        mkdirSync(dir, { recursive: true });
        return dir;
    }
    getSessionDBPath(projectDir) {
        const hash = createHash("sha256")
            .update(projectDir)
            .digest("hex")
            .slice(0, 16);
        return join(this.getSessionDir(), `${hash}.db`);
    }
    getSessionEventsPath(projectDir) {
        const hash = createHash("sha256")
            .update(projectDir)
            .digest("hex")
            .slice(0, 16);
        return join(this.getSessionDir(), `${hash}-events.md`);
    }
    generateHookConfig(pluginRoot) {
        const preToolUseCommand = `node ${pluginRoot}/hooks/pretooluse.mjs`;
        const preToolUseMatchers = [
            "Bash",
            "WebFetch",
            "Read",
            "Grep",
            "Task",
            "mcp__plugin_a8-cortex_a8-cortex__cm_execute",
            "mcp__plugin_a8-cortex_a8-cortex__cm_execute_file",
            "mcp__plugin_a8-cortex_a8-cortex__cm_batch_execute",
        ];
        return {
            PreToolUse: preToolUseMatchers.map((matcher) => ({
                matcher,
                hooks: [{ type: "command", command: preToolUseCommand }],
            })),
            PostToolUse: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: `node ${pluginRoot}/hooks/posttooluse.mjs`,
                        },
                    ],
                },
            ],
            PreCompact: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: `node ${pluginRoot}/hooks/precompact.mjs`,
                        },
                    ],
                },
            ],
            UserPromptSubmit: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: `node ${pluginRoot}/hooks/userpromptsubmit.mjs`,
                        },
                    ],
                },
            ],
            SessionStart: [
                {
                    matcher: "",
                    hooks: [
                        {
                            type: "command",
                            command: `node ${pluginRoot}/hooks/sessionstart.mjs`,
                        },
                    ],
                },
            ],
        };
    }
    readSettings() {
        try {
            const raw = readFileSync(this.getSettingsPath(), "utf-8");
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    writeSettings(settings) {
        writeFileSync(this.getSettingsPath(), JSON.stringify(settings, null, 2) + "\n", "utf-8");
    }
    // ── Diagnostics (doctor) ─────────────────────────────────
    validateHooks(pluginRoot) {
        const results = [];
        const settings = this.readSettings();
        if (!settings) {
            results.push({
                check: "PreToolUse hook",
                status: "fail",
                message: "Could not read ~/.claude/settings.json",
                fix: "a8-cortex upgrade",
            });
            return results;
        }
        const hooks = settings.hooks;
        // Read plugin hooks.json as fallback (Issue #94: plugin installs
        // register hooks in hooks/hooks.json, not in settings.json)
        const pluginHooks = this.readPluginHooks(pluginRoot);
        // Check PreToolUse (settings.json first, then plugin hooks.json fallback)
        const hasPreToolUse = this.checkHookType(hooks, pluginHooks, HOOK_TYPES.PRE_TOOL_USE);
        results.push({
            check: "PreToolUse hook",
            status: hasPreToolUse ? "pass" : "fail",
            message: hasPreToolUse
                ? "PreToolUse hook configured"
                : "No PreToolUse hooks found",
            fix: hasPreToolUse ? undefined : "a8-cortex upgrade",
        });
        // Check SessionStart (settings.json first, then plugin hooks.json fallback)
        const hasSessionStart = this.checkHookType(hooks, pluginHooks, HOOK_TYPES.SESSION_START);
        results.push({
            check: "SessionStart hook",
            status: hasSessionStart ? "pass" : "fail",
            message: hasSessionStart
                ? "SessionStart hook configured"
                : "No SessionStart hooks found",
            fix: hasSessionStart ? undefined : "a8-cortex upgrade",
        });
        return results;
    }
    /** Read plugin hooks from hooks/hooks.json or .claude-plugin/hooks/hooks.json */
    readPluginHooks(pluginRoot) {
        const candidates = [
            join(pluginRoot, "hooks", "hooks.json"),
            join(pluginRoot, ".claude-plugin", "hooks", "hooks.json"),
        ];
        for (const candidate of candidates) {
            try {
                const raw = readFileSync(candidate, "utf-8");
                const parsed = JSON.parse(raw);
                if (parsed.hooks)
                    return parsed.hooks;
            }
            catch { /* not available */ }
        }
        return undefined;
    }
    /** Check if a hook type is configured in either settings.json or plugin hooks */
    checkHookType(settingsHooks, pluginHooks, hookType) {
        // Check settings.json
        const fromSettings = settingsHooks?.[hookType];
        if (fromSettings && fromSettings.length > 0) {
            if (fromSettings.some((entry) => isContextModeHook(entry, hookType))) {
                return true;
            }
        }
        // Fallback: check plugin hooks.json
        const fromPlugin = pluginHooks?.[hookType];
        if (fromPlugin && fromPlugin.length > 0) {
            if (fromPlugin.some((entry) => isContextModeHook(entry, hookType))) {
                return true;
            }
        }
        return false;
    }
    checkPluginRegistration() {
        const settings = this.readSettings();
        if (!settings) {
            return {
                check: "Plugin registration",
                status: "warn",
                message: "Could not read settings.json",
            };
        }
        const enabledPlugins = settings.enabledPlugins;
        if (!enabledPlugins) {
            return {
                check: "Plugin registration",
                status: "warn",
                message: "No enabledPlugins section found (might be using standalone MCP mode)",
            };
        }
        const pluginKey = Object.keys(enabledPlugins).find((k) => k.startsWith("a8-cortex"));
        if (pluginKey && enabledPlugins[pluginKey]) {
            return {
                check: "Plugin registration",
                status: "pass",
                message: `Plugin enabled: ${pluginKey}`,
            };
        }
        return {
            check: "Plugin registration",
            status: "warn",
            message: "a8-cortex not in enabledPlugins (might be using standalone MCP mode)",
        };
    }
    getInstalledVersion() {
        // Primary: read from installed_plugins.json
        try {
            const ipPath = resolve(homedir(), ".claude", "plugins", "installed_plugins.json");
            const ipRaw = JSON.parse(readFileSync(ipPath, "utf-8"));
            const plugins = ipRaw.plugins ?? {};
            for (const [key, entries] of Object.entries(plugins)) {
                if (!key.toLowerCase().includes("a8-cortex"))
                    continue;
                const arr = entries;
                if (arr.length > 0 && typeof arr[0].version === "string") {
                    return arr[0].version;
                }
            }
        }
        catch {
            /* fallback below */
        }
        // Fallback: scan common plugin cache locations
        const bases = [
            resolve(homedir(), ".claude"),
            resolve(homedir(), ".config", "claude"),
        ];
        for (const base of bases) {
            const cacheDir = resolve(base, "plugins", "cache", "a8-cortex", "a8-cortex");
            try {
                const entries = readdirSync(cacheDir);
                const versions = entries
                    .filter((e) => /^\d+\.\d+\.\d+/.test(e))
                    .sort((a, b) => {
                    const pa = a.split(".").map(Number);
                    const pb = b.split(".").map(Number);
                    for (let i = 0; i < 3; i++) {
                        if ((pa[i] ?? 0) !== (pb[i] ?? 0))
                            return (pa[i] ?? 0) - (pb[i] ?? 0);
                    }
                    return 0;
                });
                if (versions.length > 0)
                    return versions[versions.length - 1];
            }
            catch {
                /* continue */
            }
        }
        return "not installed";
    }
    // ── Upgrade ────────────────────────────────────────────
    configureAllHooks(pluginRoot) {
        const settings = this.readSettings() ?? {};
        const hooks = (settings.hooks ?? {});
        const changes = [];
        const hookTypes = [
            HOOK_TYPES.PRE_TOOL_USE,
            HOOK_TYPES.SESSION_START,
        ];
        for (const hookType of hookTypes) {
            const command = buildHookCommand(hookType, pluginRoot);
            if (hookType === HOOK_TYPES.PRE_TOOL_USE) {
                const entry = {
                    matcher: PRE_TOOL_USE_MATCHER_PATTERN,
                    hooks: [{ type: "command", command }],
                };
                const existing = hooks.PreToolUse;
                if (existing && Array.isArray(existing)) {
                    const idx = existing.findIndex((e) => isContextModeHook(e, hookType));
                    if (idx >= 0) {
                        existing[idx] = entry;
                        changes.push(`Updated existing ${hookType} hook entry`);
                    }
                    else {
                        existing.push(entry);
                        changes.push(`Added ${hookType} hook entry`);
                    }
                    hooks.PreToolUse = existing;
                }
                else {
                    hooks.PreToolUse = [entry];
                    changes.push(`Created ${hookType} hooks section`);
                }
            }
            else {
                const entry = {
                    matcher: "",
                    hooks: [{ type: "command", command }],
                };
                const existing = hooks[hookType];
                if (existing && Array.isArray(existing)) {
                    const idx = existing.findIndex((e) => isContextModeHook(e, hookType));
                    if (idx >= 0) {
                        existing[idx] = entry;
                        changes.push(`Updated existing ${hookType} hook entry`);
                    }
                    else {
                        existing.push(entry);
                        changes.push(`Added ${hookType} hook entry`);
                    }
                    hooks[hookType] = existing;
                }
                else {
                    hooks[hookType] = [entry];
                    changes.push(`Created ${hookType} hooks section`);
                }
            }
        }
        settings.hooks = hooks;
        this.writeSettings(settings);
        return changes;
    }
    backupSettings() {
        const settingsPath = this.getSettingsPath();
        try {
            accessSync(settingsPath, constants.R_OK);
            const backupPath = settingsPath + ".bak";
            copyFileSync(settingsPath, backupPath);
            return backupPath;
        }
        catch {
            return null;
        }
    }
    setHookPermissions(pluginRoot) {
        const set = [];
        for (const [, scriptName] of Object.entries(HOOK_SCRIPTS)) {
            const scriptPath = resolve(pluginRoot, "hooks", scriptName);
            try {
                accessSync(scriptPath, constants.R_OK);
                chmodSync(scriptPath, 0o755);
                set.push(scriptPath);
            }
            catch {
                /* skip missing scripts */
            }
        }
        return set;
    }
    updatePluginRegistry(pluginRoot, version) {
        try {
            const ipPath = resolve(homedir(), ".claude", "plugins", "installed_plugins.json");
            const ipRaw = JSON.parse(readFileSync(ipPath, "utf-8"));
            for (const [key, entries] of Object.entries(ipRaw.plugins || {})) {
                if (!key.toLowerCase().includes("a8-cortex"))
                    continue;
                for (const entry of entries) {
                    entry.installPath = pluginRoot;
                    entry.version = version;
                    entry.lastUpdated = new Date().toISOString();
                }
            }
            writeFileSync(ipPath, JSON.stringify(ipRaw, null, 2) + "\n", "utf-8");
        }
        catch {
            /* best effort */
        }
    }
    // ── Routing Instructions (soft enforcement) ────────────
    getRoutingInstructionsConfig() {
        return {
            fileName: "CLAUDE.md",
            globalPath: resolve(homedir(), ".claude", "CLAUDE.md"),
            projectRelativePath: "CLAUDE.md",
        };
    }
    writeRoutingInstructions(projectDir, pluginRoot) {
        const config = this.getRoutingInstructionsConfig();
        const targetPath = resolve(projectDir, config.projectRelativePath);
        const sourcePath = resolve(pluginRoot, "configs", "claude-code", config.fileName);
        try {
            const content = readFileSync(sourcePath, "utf-8");
            // Check if file exists and already has a8-cortex instructions
            try {
                const existing = readFileSync(targetPath, "utf-8");
                if (existing.includes("a8-cortex"))
                    return null;
                // Append to existing file
                writeFileSync(targetPath, existing.trimEnd() + "\n\n" + content, "utf-8");
                return targetPath;
            }
            catch {
                // File doesn't exist — create it
                writeFileSync(targetPath, content, "utf-8");
                return targetPath;
            }
        }
        catch {
            return null;
        }
    }
    // ── Internal helpers ───────────────────────────────────
    /**
     * Extract session ID from Claude Code hook input.
     * Priority: transcript_path UUID > session_id field > CLAUDE_SESSION_ID env > ppid fallback.
     */
    extractSessionId(input) {
        if (input.transcript_path) {
            const match = input.transcript_path.match(/([a-f0-9-]{36})\.jsonl$/);
            if (match)
                return match[1];
        }
        if (input.session_id)
            return input.session_id;
        if (process.env.CLAUDE_SESSION_ID)
            return process.env.CLAUDE_SESSION_ID;
        return `pid-${process.ppid}`;
    }
}

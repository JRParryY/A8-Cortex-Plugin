#!/usr/bin/env node
/**
 * A8-Cortex CLI
 *
 * Usage:
 *   a8-cortex                              → Start MCP server (stdio)
 *   a8-cortex doctor                       → Diagnose runtime issues, hooks, FTS5, version
 *   a8-cortex upgrade                      → Fix hooks, permissions, and settings
 *   a8-cortex hook <platform> <event>      → Dispatch a hook script (used by platform hook configs)
 *
 * Platform auto-detection: CLI detects which platform is running
 * (Claude Code, Gemini CLI, OpenCode, etc.) and uses the appropriate adapter.
 */
/** Normalize Windows backslash paths to forward slashes for Bash (MSYS2) compatibility. */
export declare function toUnixPath(p: string): string;

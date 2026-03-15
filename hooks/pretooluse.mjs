#!/usr/bin/env node
import "./suppress-stderr.mjs";
/**
 * Unified PreToolUse hook for A8-Cortex (Claude Code)
 * Redirects data-fetching tools to A8-Cortex MCP tools
 *
 * Cross-platform (Windows/macOS/Linux) — no bash/jq dependency.
 *
 * Routing is delegated to core/routing.mjs (shared across platforms).
 * This file retains the Claude Code-specific self-heal block and
 * uses core/formatters.mjs for Claude Code output format.
 */

import { readFileSync, writeFileSync, existsSync, rmSync, mkdirSync, copyFileSync, readdirSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { readStdin } from "./core/stdin.mjs";
import { routePreToolUse, initSecurity } from "./core/routing.mjs";
import { formatDecision } from "./core/formatters.mjs";

// ─── Manual recursive copy (avoids cpSync libuv crash on non-ASCII paths, Windows + Node 24) ───
function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = resolve(src, entry.name);
    const destPath = resolve(dest, entry.name);
    if (entry.isDirectory()) copyDirSync(srcPath, destPath);
    else copyFileSync(srcPath, destPath);
  }
}

// Self-heal block removed for local fork

// ─── Init security from compiled build ───
const __hookDir = dirname(fileURLToPath(import.meta.url));
await initSecurity(resolve(__hookDir, "..", "build"));

// ─── Read stdin ───
const raw = await readStdin();
const input = JSON.parse(raw);
const tool = input.tool_name ?? "";
const toolInput = input.tool_input ?? {};

// ─── Route and format response ───
const decision = routePreToolUse(tool, toolInput, process.env.CLAUDE_PROJECT_DIR);
const response = formatDecision("claude-code", decision);
if (response !== null) {
  process.stdout.write(JSON.stringify(response) + "\n");
}

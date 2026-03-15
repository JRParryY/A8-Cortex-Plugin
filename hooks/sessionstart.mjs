#!/usr/bin/env node
import "./suppress-stderr.mjs";
/**
 * SessionStart hook for a8-cortex
 *
 * Provides the agent with XML-structured "Rules of Engagement"
 * at the beginning of each session. Injects session knowledge on
 * both startup and compact to maintain continuity.
 *
 * Session Lifecycle Rules:
 * - "startup"  → Fresh session. Inject previous session knowledge. Cleanup old data.
 * - "compact"  → Auto-compact triggered. Inject resume snapshot + stats.
 * - "resume"   → User used --continue. Full history, no resume needed.
 * - "clear"    → User cleared context. No resume.
 */

import { ROUTING_BLOCK } from "./routing-block.mjs";
import { readStdin, getSessionId, getSessionDBPath, getSessionEventsPath, getCleanupFlagPath } from "./session-helpers.mjs";
import { writeSessionEventsFile, buildSessionDirective, getSessionEvents, getLatestSessionEvents } from "./session-directive.mjs";
import { createSessionLoaders } from "./session-loaders.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";

// Resolve absolute path for imports (fileURLToPath for Windows compat)
const HOOK_DIR = dirname(fileURLToPath(import.meta.url));
const { loadSessionDB } = createSessionLoaders(HOOK_DIR);

let additionalContext = ROUTING_BLOCK;

try {
  const raw = await readStdin();
  const input = JSON.parse(raw);
  const source = input.source ?? "startup";

  if (source === "compact") {
    // Session was compacted — write events to file for auto-indexing, inject directive only
    const { SessionDB } = await loadSessionDB();
    const dbPath = getSessionDBPath();
    const db = new SessionDB({ dbPath });
    const sessionId = getSessionId(input);
    const resume = db.getResume(sessionId);

    if (resume && !resume.consumed) {
      db.markResumeConsumed(sessionId);
    }

    const events = getSessionEvents(db, sessionId);
    if (events.length > 0) {
      const eventMeta = writeSessionEventsFile(events, getSessionEventsPath());
      additionalContext += buildSessionDirective("compact", eventMeta);
    }

    // Add active services to routing block
    const serviceEvents = events.filter(e => e.category === "service");
    if (serviceEvents.length > 0) {
      const services = new Set();
      for (const ev of serviceEvents) {
        const svc = ev.data.split(":")[0].trim();
        services.add(svc);
      }
      additionalContext += `\n<active_services>${[...services].join(", ")}</active_services>`;
    }

    // Progressive skill loading — inject conventions for active services
    if (serviceEvents.length > 0) {
      const serviceConventions = {
        "Backend": "Python 3.14, FastAPI, Strawberry GraphQL, SQLAlchemy. MCP Server 49 tools. pytest tests/ -x",
        "Frontend": "Flutter/Dart 3.9+, Riverpod. Feature-based (lib/features/). a_ params, _m_ private. flutter test",
        "Nora": "Python 3.13, LangChain/LangGraph. LLM provider factory. Qdrant memory. 8 skills.",
        "Scheduler": "Python 3.13, FastAPI, aiokafka. Kafka consumers. PostgreSQL + MongoDB.",
        "Website": "Next.js 16, React 19, Tailwind 4, pnpm. Xtra Proj/a8website/.",
      };
      const activeServices = [...services];
      const hints = activeServices
        .map(svc => serviceConventions[svc])
        .filter(Boolean)
        .map(hint => `  - ${hint}`);
      if (hints.length > 0) {
        additionalContext += `\n<service_conventions>\n${hints.join("\n")}\n</service_conventions>`;
      }
    }

    db.close();
  } else if (source === "resume") {
    // User used --continue — clear cleanup flag so startup doesn't wipe data
    try { unlinkSync(getCleanupFlagPath()); } catch { /* no flag */ }

    const { SessionDB } = await loadSessionDB();
    const dbPath = getSessionDBPath();
    const db = new SessionDB({ dbPath });

    const events = getLatestSessionEvents(db);
    if (events.length > 0) {
      const eventMeta = writeSessionEventsFile(events, getSessionEventsPath());
      additionalContext += buildSessionDirective("resume", eventMeta);
    }

    // Add active services to routing block
    const serviceEvents = events.filter(e => e.category === "service");
    if (serviceEvents.length > 0) {
      const services = new Set();
      for (const ev of serviceEvents) {
        const svc = ev.data.split(":")[0].trim();
        services.add(svc);
      }
      additionalContext += `\n<active_services>${[...services].join(", ")}</active_services>`;
    }

    // Progressive skill loading — inject conventions for active services
    if (serviceEvents.length > 0) {
      const serviceConventions = {
        "Backend": "Python 3.14, FastAPI, Strawberry GraphQL, SQLAlchemy. MCP Server 49 tools. pytest tests/ -x",
        "Frontend": "Flutter/Dart 3.9+, Riverpod. Feature-based (lib/features/). a_ params, _m_ private. flutter test",
        "Nora": "Python 3.13, LangChain/LangGraph. LLM provider factory. Qdrant memory. 8 skills.",
        "Scheduler": "Python 3.13, FastAPI, aiokafka. Kafka consumers. PostgreSQL + MongoDB.",
        "Website": "Next.js 16, React 19, Tailwind 4, pnpm. Xtra Proj/a8website/.",
      };
      const activeServices = [...services];
      const hints = activeServices
        .map(svc => serviceConventions[svc])
        .filter(Boolean)
        .map(hint => `  - ${hint}`);
      if (hints.length > 0) {
        additionalContext += `\n<service_conventions>\n${hints.join("\n")}\n</service_conventions>`;
      }
    }

    db.close();
  } else if (source === "startup") {
    // Fresh session (no --continue) — clean slate, capture CLAUDE.md rules.
    const { SessionDB } = await loadSessionDB();
    const dbPath = getSessionDBPath();
    const db = new SessionDB({ dbPath });
    try { unlinkSync(getSessionEventsPath()); } catch { /* no stale file */ }

    // Detect true fresh start vs --continue (which fires startup→resume).
    // If cleanup flag exists from a PREVIOUS startup that was never followed by
    // resume, that was a true fresh start — aggressively wipe all data.
    const cleanupFlag = getCleanupFlagPath();
    let previousWasFresh = false;
    try { readFileSync(cleanupFlag); previousWasFresh = true; } catch { /* no flag */ }

    if (previousWasFresh) {
      // Previous session was a true fresh start (no --continue) — clean slate
      db.cleanupOldSessions(0);
    } else {
      // First startup or --continue will follow — only clean old sessions
      db.cleanupOldSessions(7);
    }
    db.db.exec(`DELETE FROM session_events WHERE session_id NOT IN (SELECT session_id FROM session_meta)`);

    // Write cleanup flag — resume will delete it if --continue follows
    writeFileSync(cleanupFlag, new Date().toISOString(), "utf-8");

    // Proactively capture CLAUDE.md files — Claude Code loads them as system
    // context at startup, invisible to PostToolUse hooks. We read them from
    // disk so they survive compact/resume via the session events pipeline.
    const sessionId = getSessionId(input);
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    db.ensureSession(sessionId, projectDir);
    const claudeMdPaths = [
      join(homedir(), ".claude", "CLAUDE.md"),
      join(projectDir, "CLAUDE.md"),
      join(projectDir, ".claude", "CLAUDE.md"),
    ];
    for (const p of claudeMdPaths) {
      try {
        const content = readFileSync(p, "utf-8");
        if (content.trim()) {
          db.insertEvent(sessionId, { type: "rule", category: "rule", data: p, priority: 1 });
          db.insertEvent(sessionId, { type: "rule_content", category: "rule", data: content, priority: 1 });
        }
      } catch { /* file doesn't exist — skip */ }
    }

    // Auto-index architecture docs — write paths to events file for MCP server
    const docsToIndex = [
      { path: join(projectDir, "Active-8-frontend/ARCHITECTURE.md"), source: "arch:Frontend" },
      { path: join(projectDir, "Active-8-frontend/CODING_CONVENTIONS.md"), source: "arch:Frontend:Conventions" },
      { path: join(projectDir, "nora/NORA_CAPABILITIES.md"), source: "arch:Nora:Capabilities" },
    ];
    for (const doc of docsToIndex) {
      try {
        const content = readFileSync(doc.path, "utf-8");
        if (content.trim()) {
          db.insertEvent(sessionId, { type: "rule", category: "rule", data: doc.path, priority: 1 });
        }
      } catch { /* file doesn't exist — skip */ }
    }

    // Progressive skill loading — inject service-specific conventions
    // based on which service subdirectory the project dir points to
    const serviceConventions = {
      "active-8-backend": `<service_context service="Backend">
  Stack: Python 3.14, FastAPI, Strawberry GraphQL, SQLAlchemy async, Alembic
  Patterns: MCP Server (49 tools, 12 modules), service layer, async ORM
  Test: pytest tests/ -x -q
  Lint: black app/ && isort app/ && flake8 app/ && mypy app/
</service_context>`,
      "Active-8-frontend": `<service_context service="Frontend">
  Stack: Flutter/Dart 3.9+, Riverpod
  Patterns: Feature-based modular (lib/features/), part files with mixins
  Naming: a_ params, _m_ private, c_ constants, E enums, I interfaces
  Theme: context.accentColor, context.surfaceBackground, AppTextStyles.heading()
  Test: flutter test
  Conventions: See CODING_CONVENTIONS.md and ARCHITECTURE.md
</service_context>`,
      "nora": `<service_context service="Nora">
  Stack: Python 3.13, FastAPI, LangChain/LangGraph
  Patterns: LLM provider abstraction (factory), agent orchestrator, 8 skills
  Memory: Qdrant vector DB, user-scoped semantic search
  Voice: LiveKit + Deepgram STT + Cartesia TTS
  Profile: NORA_MODEL_PROFILE env var (openai/anthropic/openrouter/mock)
</service_context>`,
      "Scheduler": `<service_context service="Scheduler">
  Stack: Python 3.13, FastAPI, aiokafka
  Patterns: Mixin-based orchestrator, Kafka consumer groups
  Topics: planner.full_cycle, planner.direct_select, planner.assign_times
  DB: PostgreSQL (structured) + MongoDB (flexible documents)
  Test: pytest tests/ -v
</service_context>`,
      "a8website": `<service_context service="Website">
  Stack: Next.js 16, React 19, Tailwind 4, pnpm
  Dir: Xtra Proj/a8website/
  Test: pnpm vitest run
  Build: pnpm build
</service_context>`,
    };

    // Detect active service from project dir
    for (const [dir, context] of Object.entries(serviceConventions)) {
      if (projectDir.includes(dir)) {
        additionalContext += "\n" + context;
        break;
      }
    }

    db.close();
  }
  // "clear" — no action needed
} catch (err) {
  // Session continuity is best-effort — never block session start
  try {
    const { appendFileSync } = await import("node:fs");
    const { join: pjoin } = await import("node:path");
    const { homedir } = await import("node:os");
    appendFileSync(
      pjoin(homedir(), ".claude", "a8-cortex", "sessionstart-debug.log"),
      `[${new Date().toISOString()}] ${err?.message || err}\n${err?.stack || ""}\n`,
    );
  } catch { /* ignore logging failure */ }
}

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext,
  },
}));

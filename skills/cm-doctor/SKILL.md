---
name: cm-doctor
description: |
  Run A8-Cortex diagnostics. Checks runtimes, hooks, FTS5,
  plugin registration, and versions.
  Trigger: /a8-cortex:cm-doctor
user-invocable: true
---

# A8-Cortex Doctor

Run diagnostics and display results directly in the conversation.

## Instructions

1. Derive the **plugin root** from this skill's base directory (go up 2 levels — remove `/skills/cm-doctor`).
2. Run with Bash:
   ```
   CLI="<PLUGIN_ROOT>/cli.bundle.mjs"; [ ! -f "$CLI" ] && CLI="<PLUGIN_ROOT>/build/cli.js"; node "$CLI" doctor
   ```
3. **IMPORTANT**: After the Bash tool completes, re-display the key results as markdown text directly in the conversation so the user sees them without expanding the tool output. Format as a checklist:
   ```
   ## A8-Cortex doctor
   - [x] Runtimes: 6/10 (javascript, typescript, python, shell, ruby, perl)
   - [x] Performance: FAST (Bun)
   - [x] Server test: PASS
   - [x] Hooks: PASS
   - [x] FTS5: PASS
   ```
   Use `[x]` for PASS, `[ ]` for FAIL, `[-]` for WARN.

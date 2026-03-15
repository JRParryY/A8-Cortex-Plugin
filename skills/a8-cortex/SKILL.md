---
name: a8-cortex
description: |
  Use A8-Cortex tools (cm_execute, cm_execute_file) for large output tasks.
  Triggers: "run tests", "test output", "coverage report", "analyze logs",
  "summarize output", "process data", "parse JSON", "filter results",
  "check build output", "fetch docs", "API reference", "call API",
  "find TODOs", "count lines", "codebase statistics".
  Does NOT trigger on normal Read, Grep, Glob, or short Bash commands.
---

# A8-Cortex: Sandbox Large Outputs

## When to Use

Use A8-Cortex tools when output is likely to exceed 100 lines:

- **Test runs**: `cm_execute(language: "shell", code: "npm test 2>&1")`
- **API calls**: `cm_execute(language: "javascript", code: "const r = await fetch(...)")`
- **Log analysis**: `cm_execute_file(path: "error.log", language: "python", code: "...")`
- **Git history**: `cm_execute(language: "shell", code: "git log --oneline -50")`
- **Web docs**: `cm_fetch_and_index(url: "...", source: "docs")`
- **Multi-step research**: `cm_batch_execute(commands: [...], queries: [...])`

## When NOT to Use

- **Reading files to edit**: Use Read (Edit needs content in context)
- **Searching code**: Use Grep/Glob directly
- **Short Bash commands**: git status, ls, mkdir, mv, npm install
- **Any command with predictably small output**

## Language Selection

| Situation | Language | Why |
|-----------|----------|-----|
| HTTP/API calls, JSON | `javascript` | Native fetch, JSON.parse, async/await |
| Data analysis, CSV, stats | `python` | csv, statistics, collections, re |
| Shell commands with pipes | `shell` | grep, awk, jq, native tools |
| File pattern matching | `shell` | find, wc, sort, uniq |

## Search Strategy

- BM25 uses OR semantics. Use 2-4 specific terms per query.
- Use `source` parameter to scope results: `cm_search(queries: [...], source: "docs")`
- Batch all queries in one call: `cm_search(queries: ["q1", "q2", "q3"])`

## Critical Rules

1. Always console.log/print your findings. stdout is all that enters context.
2. Write analysis code, not data dumps. Analyze first, print findings.
3. For files you need to EDIT: use Read. A8-Cortex is for analysis only.
4. Use `cm_index(path: ...)` to read files server-side. The `content` parameter sends data through context.

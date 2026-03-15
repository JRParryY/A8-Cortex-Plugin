# A8-Cortex Plugin

Context management plugin for Active-8 development with Claude Code. Keeps large outputs out of your context window automatically.

## Install

```bash
claude plugin marketplace add https://github.com/JRParryY/A8-Cortex-Plugin.git
claude plugin install a8-cortex
```

Restart your Claude Code session. That's it.

## What It Does

- **Automatic**: Claude uses it on its own. No manual intervention needed.
- **Read/Grep/Glob**: Fully unrestricted. Use them normally.
- **Short Bash**: git, ls, mkdir, npm install all pass through.
- **Large outputs**: Test runs, API calls, log dumps are routed to a sandbox.
- **curl/wget/WebFetch**: Blocked and redirected to sandboxed alternatives.
- **Session continuity**: Your work context survives compaction.

## Slash Commands

| Command | What It Does |
|---------|-------------|
| `/a8-cortex:cm-stats` | Show context savings for the session |
| `/a8-cortex:cm-doctor` | Run diagnostics |
| `/a8-cortex:cm-upgrade` | Rebuild locally |

## Updating

```bash
claude plugin update a8-cortex
```

Restart your Claude Code session.

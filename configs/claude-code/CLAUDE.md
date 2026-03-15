# A8-Cortex

Use A8-Cortex tools to keep large outputs out of the context window.

## When to Use A8-Cortex

- Commands producing >100 lines of output (test runs, large diffs, log dumps)
- Web content fetching (use cm_fetch_and_index instead of curl/WebFetch)
- API calls with large JSON responses
- File analysis where you only need a summary

## When NOT to Use A8-Cortex

- Reading files you intend to edit (use Read)
- Searching code (use Grep/Glob)
- Short Bash commands (git, ls, file operations)
- Any command where you need the full output in context

## Tool Reference

| Tool | Use For |
|------|---------|
| cm_execute | Large output commands, API calls, test runs |
| cm_execute_file | Analyze a file without loading into context |
| cm_batch_execute | Multiple commands + search in one call |
| cm_search | Query previously indexed content |
| cm_fetch_and_index | Fetch and index web pages |

## Rules

- DO NOT use curl/wget in Bash. Use cm_fetch_and_index or cm_execute.
- DO NOT use WebFetch. Use cm_fetch_and_index instead.

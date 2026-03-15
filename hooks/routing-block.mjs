/**
 * Shared routing block for A8-Cortex hooks.
 * Single source of truth — imported by pretooluse.mjs and sessionstart.mjs.
 */

export const ROUTING_BLOCK = `
<context_management>
  <tools>
    1. cm_batch_execute(commands, queries) - Run multiple commands, auto-index, search. For large research tasks.
    2. cm_search(queries: ["q1", "q2"]) - Search previously indexed content.
    3. cm_execute(language, code) - Run code in sandbox. Use for commands producing >100 lines.
    4. cm_execute_file(path, language, code) - Process a file without loading into context.
    5. cm_fetch_and_index(url, source) - Fetch web content, index, search.
  </tools>
  <rules>
    - Read, Grep, and Glob are your primary navigation tools. Use them freely.
    - Use cm_execute for commands likely to produce >100 lines or >50KB output.
    - DO NOT use curl/wget in Bash. Use cm_fetch_and_index or cm_execute instead.
    - Bash is fine for: git, file operations, short commands, package management.
  </rules>
</context_management>`;

export const READ_GUIDANCE = null;
export const GREP_GUIDANCE = null;
export const BASH_GUIDANCE = null;

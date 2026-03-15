/**
 * Snapshot builder — converts stored SessionEvents into an XML resume snapshot.
 *
 * Pure functions only. No database access, no file system, no side effects.
 * The output XML is injected into Claude's context after a compact event to
 * restore session awareness.
 *
 * Budget: default 2048 bytes, allocated by priority tier:
 *   P1 (file, task, rule):                          50% = ~1024 bytes
 *   P2 (cwd, error, decision, env, git):            35% = ~716 bytes
 *   P3-P4 (subagent, skill, role, data, intent):    15% = ~308 bytes
 */
/** Stored event as read from SessionDB. */
export interface StoredEvent {
    type: string;
    category: string;
    data: string;
    priority: number;
    created_at?: string;
}
export interface BuildSnapshotOpts {
    maxBytes?: number;
    compactCount?: number;
}
/**
 * Render <active_files> from file events.
 * Deduplicates by path, counts operations, keeps the last 10 files.
 */
export declare function renderActiveFiles(fileEvents: StoredEvent[]): string;
/**
 * Render <active_services> from service_touch events.
 * Groups files by service, shows per-service file counts.
 */
export declare function renderActiveServices(serviceEvents: StoredEvent[]): string;
/**
 * Render <task_state> from task events.
 * Reconstructs the full task list from create/update events,
 * filters out completed tasks, and renders only pending/in-progress work.
 *
 * TaskCreate events have `{ subject }`, TaskUpdate events have `{ taskId, status }`.
 * Match by chronological order: creates[0] → lowest taskId from updates.
 */
export declare function renderTaskState(taskEvents: StoredEvent[]): string;
/**
 * Render <rules> from rule events.
 * Lists each unique rule source path + content summaries.
 */
export declare function renderRules(ruleEvents: StoredEvent[]): string;
/**
 * Render <decisions> from decision events.
 */
export declare function renderDecisions(decisionEvents: StoredEvent[]): string;
/**
 * Render <environment> from cwd, env, and git events.
 */
export declare function renderEnvironment(cwdEvent: StoredEvent | undefined, envEvents: StoredEvent[], gitEvent: StoredEvent | undefined): string;
/**
 * Render <errors_encountered> from error events.
 */
export declare function renderErrors(errorEvents: StoredEvent[]): string;
/**
 * Render <intent> from the most recent intent event.
 */
export declare function renderIntent(intentEvent: StoredEvent): string;
/**
 * Render <subagents> from subagent events.
 * Shows agent dispatch status (launched/completed) and result summaries.
 */
export declare function renderSubagents(subagentEvents: StoredEvent[]): string;
/**
 * Render <mcp_tools> from MCP tool call events.
 * Deduplicates by tool name, shows usage count.
 */
export declare function renderMcpTools(mcpEvents: StoredEvent[]): string;
/**
 * Build a resume snapshot XML string from stored session events.
 *
 * Algorithm:
 * 1. Group events by category
 * 2. Render each section
 * 3. Assemble by priority tier with budget trimming
 * 4. If over maxBytes, drop lowest priority sections first
 */
export declare function buildResumeSnapshot(events: StoredEvent[], opts?: BuildSnapshotOpts): string;

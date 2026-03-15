/**
 * db-base — Reusable SQLite infrastructure for context-mode packages.
 *
 * Provides lazy-loading of better-sqlite3, WAL pragma setup, prepared
 * statement caching interface, and DB file cleanup helpers. Both
 * ContentStore and SessionDB build on top of these primitives.
 */
import type DatabaseConstructor from "better-sqlite3";
import type { Database as DatabaseInstance } from "better-sqlite3";
/**
 * Explicit interface for cached prepared statements that accept varying
 * parameter counts. better-sqlite3's generic `Statement` collapses under
 * `ReturnType` to a single-param signature, so we define our own.
 */
export interface PreparedStatement {
    run(...params: unknown[]): {
        changes: number;
        lastInsertRowid: number | bigint;
    };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    iterate(...params: unknown[]): IterableIterator<unknown>;
}
/**
 * Lazy-load better-sqlite3. Only resolves the native module on first call.
 * This allows the MCP server to start instantly even when the native addon
 * is not yet installed (marketplace first-run scenario).
 */
export declare function loadDatabase(): typeof DatabaseConstructor;
/**
 * Apply WAL mode and NORMAL synchronous pragma to a database instance.
 * Should be called immediately after opening a new database connection.
 *
 * WAL mode provides:
 * - Concurrent readers while a write is in progress
 * - Dramatically faster writes (no full-page sync on each commit)
 * NORMAL synchronous is safe under WAL and avoids an extra fsync per
 * transaction.
 */
export declare function applyWALPragmas(db: DatabaseInstance): void;
/**
 * Delete all three SQLite files for a given db path (main, WAL, SHM).
 * Silently ignores individual deletion errors so a partial cleanup
 * does not abort the rest.
 */
export declare function deleteDBFiles(dbPath: string): void;
/**
 * Safely close a database connection. Swallows errors so callers can
 * always call this in a finally/cleanup path without try/catch.
 */
export declare function closeDB(db: DatabaseInstance): void;
/**
 * Return the default per-process DB path for context-mode databases.
 * Uses the OS temp directory and embeds the current PID so multiple
 * server instances never share a file.
 */
export declare function defaultDBPath(prefix?: string): string;
/**
 * SQLiteBase — minimal base class that handles open/close/cleanup lifecycle.
 *
 * Subclasses call `super(dbPath)` to open the database with WAL pragmas
 * applied, then implement `initSchema()` and `prepareStatements()`.
 *
 * The `db` getter exposes the raw `DatabaseInstance` to subclasses only.
 */
export declare abstract class SQLiteBase {
    #private;
    constructor(dbPath: string);
    /** Called once after WAL pragmas are applied. Subclasses run CREATE TABLE/VIRTUAL TABLE here. */
    protected abstract initSchema(): void;
    /** Called once after schema init. Subclasses compile and cache their prepared statements here. */
    protected abstract prepareStatements(): void;
    /** Raw database instance — available to subclasses only. */
    protected get db(): DatabaseInstance;
    /** The path this database was opened from. */
    get dbPath(): string;
    /** Close the database connection without deleting files. */
    close(): void;
    /**
     * Close the connection and delete all associated DB files (main, WAL, SHM).
     * Call on process exit or at end of session lifecycle.
     */
    cleanup(): void;
}

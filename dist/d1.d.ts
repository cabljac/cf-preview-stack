import type Cloudflare from 'cloudflare';
/**
 * Create a D1 database and return its UUID.
 */
export declare function createDatabase(client: Cloudflare, accountId: string, name: string, baseDelayMs?: number): Promise<string>;
/**
 * Delete a D1 database by UUID. Swallows 404 errors (already deleted).
 */
export declare function deleteDatabase(client: Cloudflare, accountId: string, databaseId: string): Promise<void>;
/** Minimal database info returned by list. */
export interface DatabaseInfo {
    uuid: string;
    name: string;
}
/**
 * List all preview databases for a given PR number.
 * Iterates through all pages and filters by the `preview-pr-{N}-` prefix.
 */
export declare function listPreviewDatabases(client: Cloudflare, accountId: string, prNumber: number): Promise<DatabaseInfo[]>;

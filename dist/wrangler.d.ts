import type { WranglerConfig } from './types.js';
/**
 * Parse a wrangler.jsonc (or .json) config string and extract the worker name and D1 bindings.
 */
export declare function parseWranglerConfig(content: string): WranglerConfig;
/** Replacement info for a single database. */
export interface DatabaseReplacement {
    previewName: string;
    previewId: string;
}
/**
 * Rewrite a wrangler.jsonc config string, replacing database_id and database_name
 * for each D1 binding whose original database_name is in the replacements map.
 * Preserves comments, formatting, and whitespace.
 */
export declare function rewriteWranglerConfig(content: string, replacements: Map<string, DatabaseReplacement>): string;

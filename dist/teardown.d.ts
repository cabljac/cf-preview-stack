import type Cloudflare from 'cloudflare';
/**
 * Tear down all preview databases for a given PR number.
 * Continues deleting remaining databases if one fails. Returns the names of successfully deleted databases.
 */
export declare function teardownDatabases(client: Cloudflare, accountId: string, prNumber: number): Promise<string[]>;

import type Cloudflare from 'cloudflare';
interface Repo {
    owner: string;
    repo: string;
}
/**
 * Clean up orphaned preview databases for PRs that are no longer open.
 * Lists all D1 databases matching the preview prefix, checks each PR's status,
 * and deletes databases for closed/merged PRs.
 */
export declare function cleanupOrphanedDatabases(client: Cloudflare, accountId: string, githubToken: string, repo: Repo): Promise<void>;
export {};

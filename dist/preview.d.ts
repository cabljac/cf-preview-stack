import type { D1Binding, PreviewResult } from './types.js';
interface CloudflareEnv {
    apiToken: string;
    accountId: string;
}
/**
 * Run D1 migrations for all bindings that have a migrations_dir.
 * Returns the number of migration commands executed.
 */
export declare function runMigrations(bindings: D1Binding[], workingDirectory: string, cfEnv: CloudflareEnv): Promise<number>;
/**
 * Upload a preview version of a worker using wrangler versions upload.
 * Returns the worker name and preview URL.
 */
export declare function uploadPreviewVersion(workerName: string, workingDirectory: string, prNumber: number, cfEnv: CloudflareEnv): Promise<PreviewResult>;
export {};

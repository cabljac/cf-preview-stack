import type { PreviewResult, DatabaseResult } from './types.js';
export declare const COMMENT_MARKER = "<!-- cf-preview-stack -->";
interface Repo {
    owner: string;
    repo: string;
}
/**
 * Post or update a PR comment with active preview information.
 */
export declare function postPreviewComment(token: string, repo: Repo, prNumber: number, previews: PreviewResult[], databases: DatabaseResult[]): Promise<void>;
/**
 * Post or update a PR comment indicating the preview has been torn down.
 */
export declare function postTeardownComment(token: string, repo: Repo, prNumber: number): Promise<void>;
export {};

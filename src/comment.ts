import * as github from '@actions/github';
import type { PreviewResult, DatabaseResult } from './types.js';

export const COMMENT_MARKER = '<!-- cf-preview-stack -->';

interface Repo {
  owner: string;
  repo: string;
}

async function findExistingComment(
  octokit: ReturnType<typeof github.getOctokit>,
  repo: Repo,
  prNumber: number,
): Promise<number | null> {
  const { data: comments } = await octokit.rest.issues.listComments({
    ...repo,
    issue_number: prNumber,
  });

  const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
  return existing?.id ?? null;
}

function formatPreviewBody(
  prNumber: number,
  previews: PreviewResult[],
  databases: DatabaseResult[],
): string {
  const lines: string[] = [COMMENT_MARKER, '', `## ⚡ Preview Stack — PR #${prNumber}`, ''];

  if (previews.length > 0) {
    lines.push('| Worker | Preview URL |', '|--------|-------------|');
    for (const p of previews) {
      lines.push(`| ${p.workerName} | \`${p.previewUrl}\` |`);
    }
    lines.push('');
  }

  if (databases.length > 0) {
    lines.push('| Database | Preview Instance | Migrations |', '|----------|-----------------|------------|');
    for (const d of databases) {
      lines.push(`| ${d.originalName} | ${d.previewName} | ${d.migrationsApplied} applied |`);
    }
    lines.push('');
  }

  lines.push(`Last updated: ${new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`);

  return lines.join('\n');
}

function formatTeardownBody(prNumber: number): string {
  const lines: string[] = [
    COMMENT_MARKER,
    '',
    `## ⚡ Preview Stack — PR #${prNumber} (torn down)`,
    '',
    'Preview databases have been deleted. Preview URLs are no longer functional.',
  ];
  return lines.join('\n');
}

/**
 * Post or update a PR comment with active preview information.
 */
export async function postPreviewComment(
  token: string,
  repo: Repo,
  prNumber: number,
  previews: PreviewResult[],
  databases: DatabaseResult[],
): Promise<void> {
  const octokit = github.getOctokit(token);
  const body = formatPreviewBody(prNumber, previews, databases);
  const existingId = await findExistingComment(octokit, repo, prNumber);

  if (existingId) {
    await octokit.rest.issues.updateComment({ ...repo, comment_id: existingId, body });
  } else {
    await octokit.rest.issues.createComment({ ...repo, issue_number: prNumber, body });
  }
}

/**
 * Post or update a PR comment indicating the preview has been torn down.
 */
export async function postTeardownComment(
  token: string,
  repo: Repo,
  prNumber: number,
): Promise<void> {
  const octokit = github.getOctokit(token);
  const body = formatTeardownBody(prNumber);
  const existingId = await findExistingComment(octokit, repo, prNumber);

  if (existingId) {
    await octokit.rest.issues.updateComment({ ...repo, comment_id: existingId, body });
  } else {
    await octokit.rest.issues.createComment({ ...repo, issue_number: prNumber, body });
  }
}

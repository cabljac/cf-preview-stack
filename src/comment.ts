import * as github from '@actions/github';
import type { PreviewResult, DatabaseResult, KVNamespaceResult } from './types.js';

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
  let page = 1;
  while (true) {
    const { data: comments } = await octokit.rest.issues.listComments({
      ...repo,
      issue_number: prNumber,
      per_page: 100,
      page,
    });

    const existing = comments.find((c) => c.body?.includes(COMMENT_MARKER));
    if (existing) {
      return existing.id;
    }

    if (comments.length < 100) {
      return null;
    }
    page++;
  }
}

function formatPreviewBody(
  prNumber: number,
  previews: PreviewResult[],
  databases: DatabaseResult[],
  kvNamespaces: KVNamespaceResult[] = [],
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

  if (kvNamespaces.length > 0) {
    lines.push('| KV Namespace | Binding | Preview Title |', '|--------------|---------|---------------|');
    for (const kv of kvNamespaces) {
      lines.push(`| ${kv.bindingName} | ${kv.originalId} | ${kv.previewTitle} |`);
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
    'Preview databases and KV namespaces have been deleted. Preview URLs are no longer functional.',
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
  kvNamespaces: KVNamespaceResult[] = [],
): Promise<void> {
  const octokit = github.getOctokit(token);
  const body = formatPreviewBody(prNumber, previews, databases, kvNamespaces);
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

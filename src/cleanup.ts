import type Cloudflare from 'cloudflare';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { deleteDatabase } from './d1.js';
import { deleteKVNamespace } from './kv.js';

interface Repo {
  owner: string;
  repo: string;
}

interface ResourceEntry {
  id: string;
  name: string;
  prNumber: number;
  type: 'd1' | 'kv';
}

const PREVIEW_PREFIX_RE = /^preview-pr-(\d+)-/;

/**
 * Clean up orphaned preview resources (D1 databases and KV namespaces) for PRs that are no longer open.
 * Lists all resources matching the preview prefix, checks each PR's status,
 * and deletes resources for closed/merged PRs.
 */
export async function cleanupOrphanedDatabases(
  client: Cloudflare,
  accountId: string,
  githubToken: string,
  repo: Repo,
): Promise<void> {
  const entries: ResourceEntry[] = [];

  // List all D1 databases and find preview ones
  for await (const db of client.d1.database.list({ account_id: accountId })) {
    const match = db.name?.match(PREVIEW_PREFIX_RE);
    if (match) {
      entries.push({
        id: db.uuid!,
        name: db.name!,
        prNumber: parseInt(match[1], 10),
        type: 'd1',
      });
    }
  }

  // List all KV namespaces and find preview ones
  for await (const ns of client.kv.namespaces.list({ account_id: accountId })) {
    const match = ns.title?.match(PREVIEW_PREFIX_RE);
    if (match) {
      entries.push({
        id: ns.id,
        name: ns.title!,
        prNumber: parseInt(match[1], 10),
        type: 'kv',
      });
    }
  }

  if (entries.length === 0) {
    core.info('No preview resources found');
    return;
  }

  // Get unique PR numbers
  const prNumbers = [...new Set(entries.map((e) => e.prNumber))];
  core.info(`Found preview resources for PRs: ${prNumbers.join(', ')}`);

  const octokit = github.getOctokit(githubToken);

  // Check each PR status and collect closed ones
  const closedPRs = new Set<number>();
  for (const prNumber of prNumbers) {
    try {
      const { data: pr } = await octokit.rest.pulls.get({
        ...repo,
        pull_number: prNumber,
      });
      if (pr.state !== 'open') {
        closedPRs.add(prNumber);
      }
    } catch (error) {
      core.warning(`Failed to check PR #${prNumber} status, skipping: ${error}`);
    }
  }

  if (closedPRs.size === 0) {
    core.info('All preview PRs are still open, nothing to clean up');
    return;
  }

  // Delete resources for closed PRs
  let deletedCount = 0;
  for (const entry of entries) {
    if (closedPRs.has(entry.prNumber)) {
      try {
        if (entry.type === 'd1') {
          await deleteDatabase(client, accountId, entry.id);
        } else {
          await deleteKVNamespace(client, accountId, entry.id);
        }
        deletedCount++;
      } catch (error) {
        core.warning(`Failed to delete orphaned ${entry.type} resource ${entry.name}: ${error}`);
      }
    }
  }

  core.info(
    `Cleaned up ${deletedCount} resource(s) for closed PRs: ${[...closedPRs].join(', ')}`,
  );
}

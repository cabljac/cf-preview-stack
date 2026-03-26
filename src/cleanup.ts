import type Cloudflare from 'cloudflare';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { deleteDatabase } from './d1.js';

interface Repo {
  owner: string;
  repo: string;
}

interface DatabaseEntry {
  uuid: string;
  name: string;
  prNumber: number;
}

const PREVIEW_PREFIX_RE = /^preview-pr-(\d+)-/;

/**
 * Clean up orphaned preview databases for PRs that are no longer open.
 * Lists all D1 databases matching the preview prefix, checks each PR's status,
 * and deletes databases for closed/merged PRs.
 */
export async function cleanupOrphanedDatabases(
  client: Cloudflare,
  accountId: string,
  githubToken: string,
  repo: Repo,
): Promise<void> {
  // List all databases and find preview ones
  const entries: DatabaseEntry[] = [];

  for await (const db of client.d1.database.list({ account_id: accountId })) {
    const match = db.name?.match(PREVIEW_PREFIX_RE);
    if (match) {
      entries.push({
        uuid: db.uuid!,
        name: db.name!,
        prNumber: parseInt(match[1], 10),
      });
    }
  }

  if (entries.length === 0) {
    core.info('No preview databases found');
    return;
  }

  // Get unique PR numbers
  const prNumbers = [...new Set(entries.map((e) => e.prNumber))];
  core.info(`Found preview databases for PRs: ${prNumbers.join(', ')}`);

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

  // Delete databases for closed PRs
  let deletedCount = 0;
  for (const entry of entries) {
    if (closedPRs.has(entry.prNumber)) {
      try {
        await deleteDatabase(client, accountId, entry.uuid);
        deletedCount++;
      } catch (error) {
        core.warning(`Failed to delete orphaned database ${entry.name}: ${error}`);
      }
    }
  }

  core.info(
    `Cleaned up ${deletedCount} database(s) for closed PRs: ${[...closedPRs].join(', ')}`,
  );
}

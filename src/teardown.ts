import type Cloudflare from 'cloudflare';
import * as core from '@actions/core';
import { listPreviewDatabases, deleteDatabase } from './d1.js';

/**
 * Tear down all preview databases for a given PR number.
 * Continues deleting remaining databases if one fails. Returns the names of successfully deleted databases.
 */
export async function teardownDatabases(
  client: Cloudflare,
  accountId: string,
  prNumber: number,
): Promise<string[]> {
  const databases = await listPreviewDatabases(client, accountId, prNumber);

  if (databases.length === 0) {
    core.info(`No preview databases found for PR #${prNumber}`);
    return [];
  }

  core.info(`Found ${databases.length} preview database(s) for PR #${prNumber}`);

  const deleted: string[] = [];

  for (const db of databases) {
    try {
      await deleteDatabase(client, accountId, db.uuid);
      deleted.push(db.name);
    } catch (error) {
      core.warning(`Failed to delete database ${db.name} (${db.uuid}): ${error}`);
    }
  }

  return deleted;
}

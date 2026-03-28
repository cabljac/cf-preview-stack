import { readFileSync } from 'node:fs';
import type Cloudflare from 'cloudflare';
import * as core from '@actions/core';
import { listPreviewDatabases, deleteDatabase } from './d1.js';
import { listPreviewKVNamespaces, deleteKVNamespace } from './kv.js';
import { parseWranglerConfig } from './wrangler.js';
import { deleteWorker } from './preview.js';
import type { WorkerConfig } from './types.js';

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

/**
 * Tear down all preview KV namespaces for a given PR number.
 * Continues deleting remaining namespaces if one fails. Returns the titles of successfully deleted namespaces.
 */
export async function teardownKVNamespaces(
  client: Cloudflare,
  accountId: string,
  prNumber: number,
): Promise<string[]> {
  const namespaces = await listPreviewKVNamespaces(client, accountId, prNumber);

  if (namespaces.length === 0) {
    core.info(`No preview KV namespaces found for PR #${prNumber}`);
    return [];
  }

  core.info(`Found ${namespaces.length} preview KV namespace(s) for PR #${prNumber}`);

  const deleted: string[] = [];

  for (const ns of namespaces) {
    try {
      await deleteKVNamespace(client, accountId, ns.id);
      deleted.push(ns.title);
    } catch (error) {
      core.warning(`Failed to delete KV namespace ${ns.title} (${ns.id}): ${error}`);
    }
  }

  return deleted;
}

/**
 * Tear down all PR workers deployed for a given PR number.
 * Derives PR worker names from the original wrangler configs.
 */
export async function teardownWorkers(
  workers: WorkerConfig[],
  prNumber: number,
  cfEnv: { apiToken: string; accountId: string },
): Promise<void> {
  const deleted: string[] = [];

  for (const worker of workers) {
    try {
      const content = readFileSync(worker.path, 'utf-8');
      const config = parseWranglerConfig(content);
      const prWorkerName = `${config.name}-pr-${prNumber}`;
      await deleteWorker(prWorkerName, worker.workingDirectory, cfEnv);
      deleted.push(prWorkerName);
    } catch (error) {
      core.warning(`Failed to tear down worker for ${worker.path}: ${error}`);
    }
  }

  if (deleted.length > 0) {
    core.info(`Deleted PR workers: ${deleted.join(', ')}`);
  }
}

import { readFileSync, writeFileSync } from 'node:fs';
import * as core from '@actions/core';
import * as github from '@actions/github';
import Cloudflare from 'cloudflare';
import { parseWorkersInput } from './config.js';
import { parseWranglerConfig, rewriteWranglerConfig, type DatabaseReplacement } from './wrangler.js';
import { createDatabase } from './d1.js';
import { teardownDatabases } from './teardown.js';
import { runMigrations, uploadPreviewVersion } from './preview.js';
import { postPreviewComment, postTeardownComment } from './comment.js';
import { cleanupOrphanedDatabases } from './cleanup.js';
import type { PreviewResult, DatabaseResult } from './types.js';

const PREVIEW_ACTIONS = new Set(['opened', 'synchronize', 'reopened']);

/**
 * Main orchestration function. Reads action inputs, dispatches to the correct
 * lifecycle path based on event type.
 */
export async function run(): Promise<void> {
  try {
    const cloudflareApiToken = core.getInput('cloudflare_api_token');
    const cloudflareAccountId = core.getInput('cloudflare_account_id');
    const workersInput = core.getInput('workers');
    const githubToken = core.getInput('github_token');
    const shouldComment = core.getBooleanInput('comment');
    const cleanup = core.getBooleanInput('cleanup');

    const client = new Cloudflare({ apiToken: cloudflareApiToken });
    const repo = github.context.repo;
    const action = github.context.payload.action ?? '';

    // Cleanup mode — independent of PR lifecycle
    if (cleanup) {
      await cleanupOrphanedDatabases(client, cloudflareAccountId, githubToken, repo);
      return;
    }

    const prNumber = github.context.payload.pull_request?.number;
    if (!prNumber) {
      throw new Error('No pull request number found in event payload');
    }

    const cfEnv = { apiToken: cloudflareApiToken, accountId: cloudflareAccountId };

    // Closed PR — teardown only
    if (action === 'closed') {
      await teardownDatabases(client, cloudflareAccountId, prNumber);
      if (shouldComment) {
        await postTeardownComment(githubToken, repo, prNumber);
      }
      return;
    }

    // Preview lifecycle (opened / synchronize / reopened)
    if (!PREVIEW_ACTIONS.has(action)) {
      core.info(`Ignoring unsupported action: ${action}`);
      return;
    }

    const workers = parseWorkersInput(workersInput);

    // Step 1: Teardown existing preview databases
    await teardownDatabases(client, cloudflareAccountId, prNumber);

    // Step 2: Provision databases (deduplicated by database_name)
    const dbMap = new Map<string, { previewName: string; previewId: string }>();
    const allPreviews: PreviewResult[] = [];
    const allDatabaseResults: DatabaseResult[] = [];

    // Parse all worker configs and collect unique databases
    const workerConfigs = workers.map((worker) => {
      const content = readFileSync(worker.path, 'utf-8');
      const config = parseWranglerConfig(content);
      return { worker, config, originalContent: content };
    });

    // Create preview databases, deduplicating by original database_name
    for (const { config } of workerConfigs) {
      for (const binding of config.d1_databases) {
        if (dbMap.has(binding.database_name)) continue;

        const previewName = `preview-pr-${prNumber}-${binding.database_name}`;
        const previewId = await createDatabase(client, cloudflareAccountId, previewName);
        dbMap.set(binding.database_name, { previewName, previewId });
      }
    }

    // Step 3: Rewrite configs, run migrations (deduplicated), and upload each worker
    const migratedDbs = new Set<string>();

    for (const { worker, config, originalContent } of workerConfigs) {
      // Build replacements map for this worker's bindings
      const replacements = new Map<string, DatabaseReplacement>();
      for (const binding of config.d1_databases) {
        const entry = dbMap.get(binding.database_name);
        if (entry) {
          replacements.set(binding.database_name, entry);
        }
      }

      // Rewrite and write config if there are replacements
      if (replacements.size > 0) {
        const rewritten = rewriteWranglerConfig(originalContent, replacements);
        writeFileSync(worker.path, rewritten, 'utf-8');
      }

      // Build updated bindings, filtering out already-migrated databases
      const updatedBindings = config.d1_databases
        .filter((b) => !migratedDbs.has(b.database_name))
        .map((b) => {
          const entry = dbMap.get(b.database_name);
          if (entry) {
            return { ...b, database_name: entry.previewName, database_id: entry.previewId };
          }
          return b;
        });

      // Run migrations only for databases not yet migrated
      const migrationsApplied = await runMigrations(updatedBindings, worker.workingDirectory, cfEnv);

      // Mark these databases as migrated
      for (const binding of config.d1_databases) {
        migratedDbs.add(binding.database_name);
      }

      // Upload preview version
      const preview = await uploadPreviewVersion(
        config.name,
        worker.workingDirectory,
        prNumber,
        cfEnv,
      );
      allPreviews.push(preview);

      // Collect database results for this worker (deduplicated)
      for (const binding of config.d1_databases) {
        const entry = dbMap.get(binding.database_name);
        if (entry && !allDatabaseResults.some((r) => r.originalName === binding.database_name)) {
          allDatabaseResults.push({
            originalName: binding.database_name,
            previewName: entry.previewName,
            previewId: entry.previewId,
            migrationsApplied,
          });
        }
      }
    }

    // Step 4: Comment on PR
    if (shouldComment) {
      await postPreviewComment(githubToken, repo, prNumber, allPreviews, allDatabaseResults);
    }

    // Step 5: Set outputs
    const previewUrls: Record<string, string> = {};
    for (const p of allPreviews) {
      previewUrls[p.workerName] = p.previewUrl;
    }

    const databaseIds: Record<string, string> = {};
    for (const d of allDatabaseResults) {
      databaseIds[d.originalName] = d.previewId;
    }

    core.setOutput('preview_urls', JSON.stringify(previewUrls));
    core.setOutput('database_ids', JSON.stringify(databaseIds));
    core.setOutput('preview_alias', `pr-${prNumber}`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}

/* c8 ignore next 3 */
if (!process.env.VITEST) {
  run();
}

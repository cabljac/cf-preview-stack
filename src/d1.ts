import type Cloudflare from 'cloudflare';
import * as core from '@actions/core';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

function isRateLimited(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<string, unknown>).status === 429;
}

function is404(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<string, unknown>).status === 404;
}

async function withRetry<T>(fn: () => Promise<T>, baseDelayMs = BASE_DELAY_MS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimited(error) || attempt === MAX_RETRIES) {
        throw error;
      }
      const delay = baseDelayMs * 2 ** attempt;
      core.warning(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

/**
 * Create a D1 database and return its UUID.
 */
export async function createDatabase(
  client: Cloudflare,
  accountId: string,
  name: string,
  baseDelayMs = BASE_DELAY_MS,
): Promise<string> {
  const result = await withRetry(
    () => client.d1.database.create({ account_id: accountId, name }),
    baseDelayMs,
  );
  return result.uuid!;
}

/**
 * Delete a D1 database by UUID. Swallows 404 errors (already deleted).
 */
export async function deleteDatabase(
  client: Cloudflare,
  accountId: string,
  databaseId: string,
): Promise<void> {
  try {
    await withRetry(() =>
      client.d1.database.delete(databaseId, { account_id: accountId }),
    );
  } catch (error) {
    if (is404(error)) {
      core.warning(`Database ${databaseId} already deleted (404)`);
      return;
    }
    throw error;
  }
}

/** Minimal database info returned by list. */
export interface DatabaseInfo {
  uuid: string;
  name: string;
}

/**
 * List all preview databases for a given PR number.
 * Iterates through all pages and filters by the `preview-pr-{N}-` prefix.
 */
export async function listPreviewDatabases(
  client: Cloudflare,
  accountId: string,
  prNumber: number,
): Promise<DatabaseInfo[]> {
  const prefix = `preview-pr-${prNumber}-`;
  const results: DatabaseInfo[] = [];

  for await (const db of client.d1.database.list({ account_id: accountId })) {
    if (db.name?.startsWith(prefix)) {
      results.push({ uuid: db.uuid!, name: db.name });
    }
  }

  return results;
}

import type Cloudflare from 'cloudflare';
import * as core from '@actions/core';
import { withRetry, is404 } from './retry.js';

/**
 * Create a KV namespace and return its ID.
 */
export async function createKVNamespace(
  client: Cloudflare,
  accountId: string,
  title: string,
  baseDelayMs?: number,
): Promise<string> {
  const result = await withRetry(
    () => client.kv.namespaces.create({ account_id: accountId, title }),
    baseDelayMs,
  );
  return result.id;
}

/**
 * Delete a KV namespace by ID. Swallows 404 errors (already deleted).
 */
export async function deleteKVNamespace(
  client: Cloudflare,
  accountId: string,
  namespaceId: string,
): Promise<void> {
  try {
    await withRetry(() =>
      client.kv.namespaces.delete(namespaceId, { account_id: accountId }),
    );
  } catch (error) {
    if (is404(error)) {
      core.warning(`KV namespace ${namespaceId} already deleted (404)`);
      return;
    }
    throw error;
  }
}

/** Minimal KV namespace info returned by list. */
export interface KVNamespaceInfo {
  id: string;
  title: string;
}

/**
 * List all preview KV namespaces for a given PR number.
 * Iterates through all pages and filters by the `preview-pr-{N}-` prefix on title.
 */
export async function listPreviewKVNamespaces(
  client: Cloudflare,
  accountId: string,
  prNumber: number,
): Promise<KVNamespaceInfo[]> {
  const prefix = `preview-pr-${prNumber}-`;
  const results: KVNamespaceInfo[] = [];

  for await (const ns of client.kv.namespaces.list({ account_id: accountId })) {
    if (ns.title?.startsWith(prefix)) {
      results.push({ id: ns.id, title: ns.title });
    }
  }

  return results;
}

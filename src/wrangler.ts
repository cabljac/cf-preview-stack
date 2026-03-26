import { parse, modify, applyEdits, type ModificationOptions } from 'jsonc-parser';
import type { WranglerConfig, D1Binding, KVBinding } from './types.js';

const MODIFICATION_OPTIONS: ModificationOptions = {
  formattingOptions: { tabSize: 2, insertSpaces: true },
};

/**
 * Parse a wrangler.jsonc (or .json) config string and extract the worker name and D1 bindings.
 */
export function parseWranglerConfig(content: string): WranglerConfig {
  const root = parse(content);

  const d1Databases: D1Binding[] = (root.d1_databases ?? []).map(
    (db: Record<string, string | undefined>) => {
      const binding: D1Binding = {
        binding: db.binding!,
        database_name: db.database_name!,
        database_id: db.database_id!,
      };
      if (db.migrations_dir) {
        binding.migrations_dir = db.migrations_dir;
      }
      return binding;
    },
  );

  const kvNamespaces: KVBinding[] = (root.kv_namespaces ?? []).map(
    (ns: Record<string, string>) => ({
      binding: ns.binding!,
      id: ns.id!,
    }),
  );

  return {
    name: root.name,
    d1_databases: d1Databases,
    kv_namespaces: kvNamespaces,
  };
}

/** Replacement info for a single database. */
export interface DatabaseReplacement {
  previewName: string;
  previewId: string;
}

/**
 * Rewrite a wrangler.jsonc config string, replacing database_id and database_name
 * for each D1 binding whose original database_name is in the replacements map.
 * Preserves comments, formatting, and whitespace.
 */
export function rewriteWranglerConfig(
  content: string,
  replacements: Map<string, DatabaseReplacement>,
): string {
  const root = parse(content);
  const databases: Array<Record<string, string>> = root.d1_databases ?? [];

  let result = content;

  // Apply edits in reverse order to preserve earlier offsets
  for (let i = databases.length - 1; i >= 0; i--) {
    const db = databases[i];
    const replacement = replacements.get(db.database_name);
    if (!replacement) continue;

    // Rewrite database_name first, then database_id (reverse field order doesn't matter
    // since jsonc-parser recalculates offsets from the current string)
    let edits = modify(result, ['d1_databases', i, 'database_name'], replacement.previewName, MODIFICATION_OPTIONS);
    result = applyEdits(result, edits);

    edits = modify(result, ['d1_databases', i, 'database_id'], replacement.previewId, MODIFICATION_OPTIONS);
    result = applyEdits(result, edits);
  }

  return result;
}

/** Replacement info for a single KV namespace. */
export interface KVReplacement {
  previewId: string;
}

/**
 * Rewrite a wrangler.jsonc config string, replacing the `id` field
 * for each KV namespace binding whose original id is in the replacements map.
 * Preserves comments, formatting, and whitespace.
 */
export function rewriteKVNamespaces(
  content: string,
  replacements: Map<string, KVReplacement>,
): string {
  const root = parse(content);
  const namespaces: Array<Record<string, string>> = root.kv_namespaces ?? [];

  let result = content;

  for (let i = namespaces.length - 1; i >= 0; i--) {
    const ns = namespaces[i];
    const replacement = replacements.get(ns.id);
    if (!replacement) continue;

    const edits = modify(result, ['kv_namespaces', i, 'id'], replacement.previewId, MODIFICATION_OPTIONS);
    result = applyEdits(result, edits);
  }

  return result;
}

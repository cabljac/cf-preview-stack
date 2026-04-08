import { parse, modify, applyEdits, type ModificationOptions } from 'jsonc-parser';
import type { WranglerConfig, D1Binding, KVBinding, WorkflowBinding } from './types.js';

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

  const workflows: WorkflowBinding[] = (root.workflows ?? []).map(
    (wf: Record<string, string | undefined>) => {
      const binding: WorkflowBinding = {
        binding: wf.binding!,
        name: wf.name!,
      };
      if (wf.class_name) binding.class_name = wf.class_name;
      if (wf.script_name) binding.script_name = wf.script_name;
      return binding;
    },
  );

  return {
    name: root.name,
    d1_databases: d1Databases,
    kv_namespaces: kvNamespaces,
    workflows,
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

/** Replacement info for a single workflow. */
export interface WorkflowReplacement {
  previewName: string;
}

/**
 * Rewrite a wrangler.jsonc config string, replacing the `name` field
 * for each workflow binding whose original name is in the replacements map.
 * Preserves comments, formatting, and whitespace.
 */
export function rewriteWorkflowNames(
  content: string,
  replacements: Map<string, WorkflowReplacement>,
): string {
  const root = parse(content);
  const workflows: Array<Record<string, string>> = root.workflows ?? [];

  let result = content;

  for (let i = workflows.length - 1; i >= 0; i--) {
    const wf = workflows[i];
    const replacement = replacements.get(wf.name);
    if (!replacement) continue;

    const edits = modify(result, ['workflows', i, 'name'], replacement.previewName, MODIFICATION_OPTIONS);
    result = applyEdits(result, edits);
  }

  return result;
}

/**
 * Rewrite a wrangler.jsonc config string, adding or overwriting entries
 * in the top-level `vars` object. Each key-value pair becomes an
 * environment variable available to the Worker at runtime.
 * Preserves comments, formatting, and whitespace.
 */
export function rewriteVars(
  content: string,
  vars: Record<string, string>,
): string {
  let result = content;
  for (const [key, value] of Object.entries(vars)) {
    const edits = modify(result, ['vars', key], value, MODIFICATION_OPTIONS);
    result = applyEdits(result, edits);
  }
  return result;
}

/**
 * Rewrite the worker name and enable workers_dev so the PR worker gets
 * a *.workers.dev URL and is fully isolated from the production worker.
 * Also clears routes, patterns, and custom_domains to prevent conflicts
 * with the production worker's routing configuration.
 * Preserves comments, formatting, and whitespace.
 */
export function rewriteWorkerName(content: string, name: string): string {
  let result = content;

  let edits = modify(result, ['name'], name, MODIFICATION_OPTIONS);
  result = applyEdits(result, edits);

  edits = modify(result, ['workers_dev'], true, MODIFICATION_OPTIONS);
  result = applyEdits(result, edits);

  // Remove production routing config so the PR worker never conflicts with
  // the production worker. workers_dev: true is sufficient for preview access.
  const root = parse(result);
  for (const key of ['routes', 'patterns', 'custom_domains'] as const) {
    if (root[key] !== undefined) {
      edits = modify(result, [key], undefined, MODIFICATION_OPTIONS);
      result = applyEdits(result, edits);
    }
  }

  return result;
}

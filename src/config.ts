import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { WorkerConfig } from './types.js';

/**
 * Parse the `workers` YAML input into an array of WorkerConfig objects.
 * Supports simple string list, expanded object list, or a mix of both.
 */
export function parseWorkersInput(input: string): WorkerConfig[] {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('workers input must not be empty');
  }

  const parsed: unknown = parseYaml(trimmed);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('workers input must be a non-empty YAML list');
  }

  return parsed.map((entry: unknown) => {
    if (typeof entry === 'string') {
      const dir = path.dirname(entry);
      return {
        path: entry,
        workingDirectory: dir === '' ? '.' : dir,
      };
    }

    if (typeof entry === 'object' && entry !== null && 'path' in entry) {
      const obj = entry as { path: string; working_directory?: string; migration_command?: string };
      return {
        path: obj.path,
        workingDirectory: obj.working_directory ?? (path.dirname(obj.path) || '.'),
        migrationCommand: obj.migration_command,
      };
    }

    throw new Error(`Invalid workers entry: ${JSON.stringify(entry)}`);
  });
}

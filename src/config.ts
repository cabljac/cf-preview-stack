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
      const obj = entry as { path: string; working_directory?: string };
      const workDir = obj.working_directory ?? (path.dirname(obj.path) || '.');

      // When working_directory is explicitly provided and the path isn't already
      // within it, resolve the path relative to working_directory.
      let configPath = obj.path;
      if (obj.working_directory) {
        const normalizedPath = path.normalize(obj.path);
        const normalizedDir = path.normalize(obj.working_directory);
        if (!normalizedPath.startsWith(normalizedDir + path.sep) && normalizedPath !== normalizedDir) {
          configPath = path.join(obj.working_directory, obj.path);
        }
      }

      return {
        path: configPath,
        workingDirectory: workDir,
      };
    }

    throw new Error(`Invalid workers entry: ${JSON.stringify(entry)}`);
  });
}

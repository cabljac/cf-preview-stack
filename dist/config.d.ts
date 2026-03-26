import type { WorkerConfig } from './types.js';
/**
 * Parse the `workers` YAML input into an array of WorkerConfig objects.
 * Supports simple string list, expanded object list, or a mix of both.
 */
export declare function parseWorkersInput(input: string): WorkerConfig[];

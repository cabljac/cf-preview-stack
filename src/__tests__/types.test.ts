import { test, expect } from 'vitest';
import type { WorkerConfig, D1Binding, WranglerConfig, PreviewResult, DatabaseResult, ActionInputs } from '../types.js';

test('types are importable', () => {
  const config: WorkerConfig = { path: './wrangler.jsonc', workingDirectory: '.' };
  expect(config.path).toBe('./wrangler.jsonc');
});

import { test, expect, describe } from 'vitest';
import { parseWorkersInput } from '../config.js';

describe('parseWorkersInput', () => {
  test('parses simple string list with inferred working directories', () => {
    const input = `
- ./api/wrangler.jsonc
- ./web/wrangler.jsonc
`;
    const result = parseWorkersInput(input);
    expect(result).toEqual([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
      { path: './web/wrangler.jsonc', workingDirectory: './web' },
    ]);
  });

  test('parses expanded object list with explicit working directories', () => {
    const input = `
- path: ./packages/api/wrangler.jsonc
  working_directory: ./packages/api
- path: ./packages/web/wrangler.jsonc
  working_directory: ./packages/web
`;
    const result = parseWorkersInput(input);
    expect(result).toEqual([
      { path: './packages/api/wrangler.jsonc', workingDirectory: './packages/api' },
      { path: './packages/web/wrangler.jsonc', workingDirectory: './packages/web' },
    ]);
  });

  test('parses mixed list (strings and objects)', () => {
    const input = `
- ./api/wrangler.jsonc
- path: ./packages/web/wrangler.jsonc
  working_directory: ./packages/web
`;
    const result = parseWorkersInput(input);
    expect(result).toEqual([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
      { path: './packages/web/wrangler.jsonc', workingDirectory: './packages/web' },
    ]);
  });

  test('resolves relative paths against repo root', () => {
    const input = `
- wrangler.jsonc
`;
    const result = parseWorkersInput(input);
    expect(result).toEqual([
      { path: 'wrangler.jsonc', workingDirectory: '.' },
    ]);
  });

  test('parses deploy_config field for Vite plugin pattern', () => {
    const input = `
- path: apps/analytics/wrangler.jsonc
  deploy_config: apps/analytics/dist/memcard_analytics/wrangler.json
  working_directory: apps/analytics
`;
    const result = parseWorkersInput(input);
    expect(result).toEqual([
      {
        path: 'apps/analytics/wrangler.jsonc',
        workingDirectory: 'apps/analytics',
        deployConfig: 'apps/analytics/dist/memcard_analytics/wrangler.json',
      },
    ]);
  });

  test('deploy_config defaults to undefined when not provided', () => {
    const input = `
- path: ./api/wrangler.jsonc
  working_directory: ./api
`;
    const result = parseWorkersInput(input);
    expect(result[0].deployConfig).toBeUndefined();
  });

  test('simple string entries have no deployConfig', () => {
    const input = `- ./api/wrangler.jsonc`;
    const result = parseWorkersInput(input);
    expect(result[0].deployConfig).toBeUndefined();
  });

  test('throws on empty input', () => {
    expect(() => parseWorkersInput('')).toThrow();
    expect(() => parseWorkersInput('  ')).toThrow();
  });

  test('throws on invalid YAML', () => {
    expect(() => parseWorkersInput('}{not yaml')).toThrow();
  });
});

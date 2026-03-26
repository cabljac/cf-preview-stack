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

  test('throws on empty input', () => {
    expect(() => parseWorkersInput('')).toThrow();
    expect(() => parseWorkersInput('  ')).toThrow();
  });

  test('throws on invalid YAML', () => {
    expect(() => parseWorkersInput('}{not yaml')).toThrow();
  });

  test('parses migration_command from expanded object', () => {
    const input = `
- path: ./api/wrangler.jsonc
  working_directory: ./api
  migration_command: "npx drizzle-kit push"
`;
    const result = parseWorkersInput(input);
    expect(result).toEqual([
      { path: './api/wrangler.jsonc', workingDirectory: './api', migrationCommand: 'npx drizzle-kit push' },
    ]);
  });

  test('migrationCommand is undefined when not specified', () => {
    const input = `
- path: ./api/wrangler.jsonc
  working_directory: ./api
`;
    const result = parseWorkersInput(input);
    expect(result[0].migrationCommand).toBeUndefined();
  });

  test('migrationCommand is undefined for simple string entries', () => {
    const input = `
- ./api/wrangler.jsonc
`;
    const result = parseWorkersInput(input);
    expect(result[0].migrationCommand).toBeUndefined();
  });
});

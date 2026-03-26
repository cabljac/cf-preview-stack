import { test, expect, describe } from 'vitest';
import { parseWranglerConfig, rewriteWranglerConfig } from '../wrangler.js';

const BASIC_CONFIG = `{
  // Worker name
  "name": "api",
  "main": "src/index.ts",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mydb",
      "database_id": "original-uuid-1234",
      "migrations_dir": "./migrations"
    }
  ]
}`;

const NO_D1_CONFIG = `{
  "name": "static-worker",
  "main": "src/index.ts"
}`;

const MULTI_D1_CONFIG = `{
  "name": "multi-db",
  "d1_databases": [
    {
      "binding": "PRIMARY",
      "database_name": "primary-db",
      "database_id": "uuid-primary",
      "migrations_dir": "./migrations/primary"
    },
    {
      "binding": "ANALYTICS",
      "database_name": "analytics-db",
      "database_id": "uuid-analytics"
    }
  ]
}`;

describe('parseWranglerConfig', () => {
  test('extracts worker name from config', () => {
    const result = parseWranglerConfig(BASIC_CONFIG);
    expect(result.name).toBe('api');
  });

  test('extracts D1 bindings (database_name, database_id, migrations_dir)', () => {
    const result = parseWranglerConfig(BASIC_CONFIG);
    expect(result.d1_databases).toEqual([
      {
        binding: 'DB',
        database_name: 'mydb',
        database_id: 'original-uuid-1234',
        migrations_dir: './migrations',
      },
    ]);
  });

  test('handles config with no D1 bindings — empty array', () => {
    const result = parseWranglerConfig(NO_D1_CONFIG);
    expect(result.d1_databases).toEqual([]);
  });

  test('handles multiple D1 bindings in one config', () => {
    const result = parseWranglerConfig(MULTI_D1_CONFIG);
    expect(result.d1_databases).toHaveLength(2);
    expect(result.d1_databases[0].binding).toBe('PRIMARY');
    expect(result.d1_databases[1].binding).toBe('ANALYTICS');
    expect(result.d1_databases[1].migrations_dir).toBeUndefined();
  });

  test('handles .json files (not just .jsonc)', () => {
    const jsonConfig = '{"name": "json-worker", "d1_databases": [{"binding": "DB", "database_name": "db1", "database_id": "uuid-1"}]}';
    const result = parseWranglerConfig(jsonConfig);
    expect(result.name).toBe('json-worker');
    expect(result.d1_databases).toHaveLength(1);
  });
});

describe('rewriteWranglerConfig', () => {
  test('rewrites database_id and database_name for each binding', () => {
    const replacements = new Map([
      ['mydb', { previewName: 'preview-pr-42-mydb', previewId: 'new-uuid-5678' }],
    ]);
    const result = rewriteWranglerConfig(BASIC_CONFIG, replacements);
    expect(result).toContain('new-uuid-5678');
    expect(result).toContain('preview-pr-42-mydb');
    expect(result).not.toContain('original-uuid-1234');
  });

  test('preserves comments in JSONC after rewrite', () => {
    const replacements = new Map([
      ['mydb', { previewName: 'preview-pr-42-mydb', previewId: 'new-uuid-5678' }],
    ]);
    const result = rewriteWranglerConfig(BASIC_CONFIG, replacements);
    expect(result).toContain('// Worker name');
  });

  test('preserves formatting/whitespace after rewrite', () => {
    const replacements = new Map([
      ['mydb', { previewName: 'preview-pr-42-mydb', previewId: 'new-uuid-5678' }],
    ]);
    const result = rewriteWranglerConfig(BASIC_CONFIG, replacements);
    // Should still be indented and multi-line, not collapsed
    expect(result).toContain('  "name": "api"');
    expect(result).toContain('  "main": "src/index.ts"');
  });

  test('rewrites multiple D1 bindings', () => {
    const replacements = new Map([
      ['primary-db', { previewName: 'preview-pr-7-primary-db', previewId: 'new-uuid-primary' }],
      ['analytics-db', { previewName: 'preview-pr-7-analytics-db', previewId: 'new-uuid-analytics' }],
    ]);
    const result = rewriteWranglerConfig(MULTI_D1_CONFIG, replacements);
    expect(result).toContain('new-uuid-primary');
    expect(result).toContain('preview-pr-7-primary-db');
    expect(result).toContain('new-uuid-analytics');
    expect(result).toContain('preview-pr-7-analytics-db');
    // Verify original IDs are replaced (check exact quoted values)
    expect(result).not.toContain('"uuid-primary"');
    expect(result).not.toContain('"uuid-analytics"');
  });
});

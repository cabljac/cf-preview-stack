import { test, expect, describe } from 'vitest';
import { parseWranglerConfig, rewriteWranglerConfig, rewriteKVNamespaces } from '../wrangler.js';

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

const KV_CONFIG = `{
  // Worker with KV
  "name": "kv-worker",
  "kv_namespaces": [
    {
      "binding": "MY_KV",
      "id": "original-ns-id-1234"
    }
  ]
}`;

const MULTI_KV_CONFIG = `{
  "name": "multi-kv",
  "kv_namespaces": [
    {
      "binding": "CACHE",
      "id": "ns-cache-id"
    },
    {
      "binding": "SESSIONS",
      "id": "ns-sessions-id"
    }
  ]
}`;

const COMBINED_CONFIG = `{
  // Worker with D1 and KV
  "name": "full-worker",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "mydb",
      "database_id": "db-uuid-1234",
      "migrations_dir": "./migrations"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "MY_KV",
      "id": "ns-id-5678"
    }
  ]
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
    expect(result.kv_namespaces).toEqual([]);
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

describe('parseWranglerConfig — KV namespaces', () => {
  test('extracts KV bindings (binding, id)', () => {
    const result = parseWranglerConfig(KV_CONFIG);
    expect(result.kv_namespaces).toEqual([
      { binding: 'MY_KV', id: 'original-ns-id-1234' },
    ]);
  });

  test('handles config with no KV bindings — empty array', () => {
    const result = parseWranglerConfig(BASIC_CONFIG);
    expect(result.kv_namespaces).toEqual([]);
  });

  test('handles multiple KV bindings', () => {
    const result = parseWranglerConfig(MULTI_KV_CONFIG);
    expect(result.kv_namespaces).toHaveLength(2);
    expect(result.kv_namespaces[0].binding).toBe('CACHE');
    expect(result.kv_namespaces[1].binding).toBe('SESSIONS');
  });

  test('parses combined D1 + KV config', () => {
    const result = parseWranglerConfig(COMBINED_CONFIG);
    expect(result.d1_databases).toHaveLength(1);
    expect(result.kv_namespaces).toHaveLength(1);
    expect(result.d1_databases[0].binding).toBe('DB');
    expect(result.kv_namespaces[0].binding).toBe('MY_KV');
  });
});

describe('rewriteKVNamespaces', () => {
  test('rewrites id field for matched namespaces', () => {
    const replacements = new Map([
      ['original-ns-id-1234', { previewId: 'new-ns-id-5678' }],
    ]);
    const result = rewriteKVNamespaces(KV_CONFIG, replacements);
    expect(result).toContain('new-ns-id-5678');
    expect(result).not.toContain('original-ns-id-1234');
  });

  test('preserves comments and formatting', () => {
    const replacements = new Map([
      ['original-ns-id-1234', { previewId: 'new-ns-id-5678' }],
    ]);
    const result = rewriteKVNamespaces(KV_CONFIG, replacements);
    expect(result).toContain('// Worker with KV');
    expect(result).toContain('  "name": "kv-worker"');
  });

  test('rewrites multiple KV bindings', () => {
    const replacements = new Map([
      ['ns-cache-id', { previewId: 'preview-cache-id' }],
      ['ns-sessions-id', { previewId: 'preview-sessions-id' }],
    ]);
    const result = rewriteKVNamespaces(MULTI_KV_CONFIG, replacements);
    expect(result).toContain('preview-cache-id');
    expect(result).toContain('preview-sessions-id');
    expect(result).not.toContain('"ns-cache-id"');
    expect(result).not.toContain('"ns-sessions-id"');
  });

  test('combined D1 + KV config rewrites both correctly', () => {
    const dbReplacements = new Map([
      ['mydb', { previewName: 'preview-pr-42-mydb', previewId: 'new-db-uuid' }],
    ]);
    const kvReplacements = new Map([
      ['ns-id-5678', { previewId: 'new-ns-id' }],
    ]);
    let result = rewriteWranglerConfig(COMBINED_CONFIG, dbReplacements);
    result = rewriteKVNamespaces(result, kvReplacements);
    expect(result).toContain('new-db-uuid');
    expect(result).toContain('preview-pr-42-mydb');
    expect(result).toContain('new-ns-id');
    expect(result).toContain('// Worker with D1 and KV');
  });
});

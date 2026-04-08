import { test, expect, describe } from 'vitest';
import { parse as parseJsonc } from 'jsonc-parser';
import { parseWranglerConfig, rewriteWranglerConfig, rewriteKVNamespaces, rewriteWorkflowNames, rewriteVars, rewriteWorkerName } from '../wrangler.js';

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

const WORKFLOW_PRODUCER_CONFIG = `{
  // Worker with workflow producer
  "name": "account-lifecycle",
  "workflows": [
    {
      "binding": "DELETE_ACCOUNT",
      "name": "delete-account-workflow",
      "class_name": "DeleteAccountWorkflow"
    }
  ]
}`;

const WORKFLOW_CONSUMER_CONFIG = `{
  "name": "web",
  "workflows": [
    {
      "binding": "GENERATE_COURSE",
      "name": "generate-course-workflow",
      "script_name": "course-generation"
    }
  ]
}`;

const MULTI_WORKFLOW_CONFIG = `{
  "name": "multi-workflow",
  "workflows": [
    {
      "binding": "DELETE_ACCOUNT",
      "name": "delete-account-workflow",
      "class_name": "DeleteAccountWorkflow"
    },
    {
      "binding": "GENERATE_COURSE",
      "name": "generate-course-workflow",
      "script_name": "course-generation"
    }
  ]
}`;

const COMBINED_ALL_CONFIG = `{
  // Worker with everything
  "name": "full-stack",
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
  ],
  "workflows": [
    {
      "binding": "MY_WORKFLOW",
      "name": "my-workflow",
      "class_name": "MyWorkflow"
    }
  ]
}`;

const VARS_CONFIG = `{
  // Worker with existing vars
  "name": "vars-worker",
  "main": "src/index.ts",
  "vars": {
    "EXISTING_VAR": "keep-me"
  }
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

describe('parseWranglerConfig — workflows', () => {
  test('extracts workflow producer bindings (binding, name, class_name)', () => {
    const result = parseWranglerConfig(WORKFLOW_PRODUCER_CONFIG);
    expect(result.workflows).toEqual([
      {
        binding: 'DELETE_ACCOUNT',
        name: 'delete-account-workflow',
        class_name: 'DeleteAccountWorkflow',
      },
    ]);
  });

  test('extracts workflow consumer bindings (binding, name, script_name)', () => {
    const result = parseWranglerConfig(WORKFLOW_CONSUMER_CONFIG);
    expect(result.workflows).toEqual([
      {
        binding: 'GENERATE_COURSE',
        name: 'generate-course-workflow',
        script_name: 'course-generation',
      },
    ]);
  });

  test('handles config with no workflows — empty array', () => {
    const result = parseWranglerConfig(BASIC_CONFIG);
    expect(result.workflows).toEqual([]);
  });

  test('handles multiple workflow bindings', () => {
    const result = parseWranglerConfig(MULTI_WORKFLOW_CONFIG);
    expect(result.workflows).toHaveLength(2);
    expect(result.workflows[0].binding).toBe('DELETE_ACCOUNT');
    expect(result.workflows[0].class_name).toBe('DeleteAccountWorkflow');
    expect(result.workflows[1].binding).toBe('GENERATE_COURSE');
    expect(result.workflows[1].script_name).toBe('course-generation');
  });

  test('parses combined D1 + KV + workflows config', () => {
    const result = parseWranglerConfig(COMBINED_ALL_CONFIG);
    expect(result.d1_databases).toHaveLength(1);
    expect(result.kv_namespaces).toHaveLength(1);
    expect(result.workflows).toHaveLength(1);
    expect(result.workflows[0].name).toBe('my-workflow');
  });
});

describe('rewriteWorkflowNames', () => {
  test('rewrites name field for producer workflow', () => {
    const replacements = new Map([
      ['delete-account-workflow', { previewName: 'preview-pr-42-delete-account-workflow' }],
    ]);
    const result = rewriteWorkflowNames(WORKFLOW_PRODUCER_CONFIG, replacements);
    expect(result).toContain('preview-pr-42-delete-account-workflow');
    expect(result).not.toContain('"delete-account-workflow"');
  });

  test('rewrites name field for consumer workflow', () => {
    const replacements = new Map([
      ['generate-course-workflow', { previewName: 'preview-pr-7-generate-course-workflow' }],
    ]);
    const result = rewriteWorkflowNames(WORKFLOW_CONSUMER_CONFIG, replacements);
    expect(result).toContain('preview-pr-7-generate-course-workflow');
    expect(result).not.toContain('"generate-course-workflow"');
  });

  test('preserves comments and formatting', () => {
    const replacements = new Map([
      ['delete-account-workflow', { previewName: 'preview-pr-42-delete-account-workflow' }],
    ]);
    const result = rewriteWorkflowNames(WORKFLOW_PRODUCER_CONFIG, replacements);
    expect(result).toContain('// Worker with workflow producer');
    expect(result).toContain('  "name": "account-lifecycle"');
  });

  test('rewrites multiple workflow bindings', () => {
    const replacements = new Map([
      ['delete-account-workflow', { previewName: 'preview-pr-10-delete-account-workflow' }],
      ['generate-course-workflow', { previewName: 'preview-pr-10-generate-course-workflow' }],
    ]);
    const result = rewriteWorkflowNames(MULTI_WORKFLOW_CONFIG, replacements);
    expect(result).toContain('preview-pr-10-delete-account-workflow');
    expect(result).toContain('preview-pr-10-generate-course-workflow');
    expect(result).not.toContain('"delete-account-workflow"');
    expect(result).not.toContain('"generate-course-workflow"');
  });

  test('skips workflows not in replacement map', () => {
    const replacements = new Map([
      ['delete-account-workflow', { previewName: 'preview-pr-10-delete-account-workflow' }],
    ]);
    const result = rewriteWorkflowNames(MULTI_WORKFLOW_CONFIG, replacements);
    expect(result).toContain('preview-pr-10-delete-account-workflow');
    // Second workflow should be unchanged
    expect(result).toContain('"generate-course-workflow"');
  });

  test('combined D1 + KV + workflows config rewrites all correctly', () => {
    const dbReplacements = new Map([
      ['mydb', { previewName: 'preview-pr-42-mydb', previewId: 'new-db-uuid' }],
    ]);
    const kvReplacements = new Map([
      ['ns-id-5678', { previewId: 'new-ns-id' }],
    ]);
    const wfReplacements = new Map([
      ['my-workflow', { previewName: 'preview-pr-42-my-workflow' }],
    ]);
    let result = rewriteWranglerConfig(COMBINED_ALL_CONFIG, dbReplacements);
    result = rewriteKVNamespaces(result, kvReplacements);
    result = rewriteWorkflowNames(result, wfReplacements);
    expect(result).toContain('new-db-uuid');
    expect(result).toContain('preview-pr-42-mydb');
    expect(result).toContain('new-ns-id');
    expect(result).toContain('preview-pr-42-my-workflow');
    expect(result).toContain('// Worker with everything');
  });
});

describe('rewriteVars', () => {
  test('adds vars to a config with no existing vars section', () => {
    const result = rewriteVars(NO_D1_CONFIG, { AUTH_SECRET: 'my-secret-123' });
    const parsed = JSON.parse(result);
    expect(parsed.vars.AUTH_SECRET).toBe('my-secret-123');
  });

  test('overwrites existing vars values', () => {
    const result = rewriteVars(VARS_CONFIG, { EXISTING_VAR: 'new-value' });
    const parsed = parseJsonc(result);
    expect(parsed.vars.EXISTING_VAR).toBe('new-value');
  });

  test('merges new vars with existing vars', () => {
    const result = rewriteVars(VARS_CONFIG, { NEW_KEY: 'new-value' });
    const parsed = parseJsonc(result);
    expect(parsed.vars.EXISTING_VAR).toBe('keep-me');
    expect(parsed.vars.NEW_KEY).toBe('new-value');
  });

  test('handles multiple vars at once', () => {
    const result = rewriteVars(NO_D1_CONFIG, {
      AUTH_SECRET: 'secret-1',
      GOOGLE_CLIENT_ID: 'google-id',
      GOOGLE_CLIENT_SECRET: 'google-secret',
    });
    const parsed = JSON.parse(result);
    expect(parsed.vars.AUTH_SECRET).toBe('secret-1');
    expect(parsed.vars.GOOGLE_CLIENT_ID).toBe('google-id');
    expect(parsed.vars.GOOGLE_CLIENT_SECRET).toBe('google-secret');
  });

  test('preserves JSONC comments and formatting', () => {
    const result = rewriteVars(VARS_CONFIG, { NEW_KEY: 'val' });
    expect(result).toContain('// Worker with existing vars');
    expect(result).toContain('  "name": "vars-worker"');
  });

  test('empty vars object returns content unchanged', () => {
    const result = rewriteVars(VARS_CONFIG, {});
    expect(result).toBe(VARS_CONFIG);
  });

  test('works chained with D1 + KV + workflow rewrites', () => {
    const dbReplacements = new Map([
      ['mydb', { previewName: 'preview-pr-42-mydb', previewId: 'new-db-uuid' }],
    ]);
    const kvReplacements = new Map([
      ['ns-id-5678', { previewId: 'new-ns-id' }],
    ]);
    const wfReplacements = new Map([
      ['my-workflow', { previewName: 'preview-pr-42-my-workflow' }],
    ]);
    let result = rewriteWranglerConfig(COMBINED_ALL_CONFIG, dbReplacements);
    result = rewriteKVNamespaces(result, kvReplacements);
    result = rewriteWorkflowNames(result, wfReplacements);
    result = rewriteVars(result, { AUTH_SECRET: 'preview-secret' });
    const parsed = parseJsonc(result);
    expect(parsed.vars.AUTH_SECRET).toBe('preview-secret');
    expect(parsed.d1_databases[0].database_id).toBe('new-db-uuid');
    expect(parsed.kv_namespaces[0].id).toBe('new-ns-id');
    expect(parsed.workflows[0].name).toBe('preview-pr-42-my-workflow');
  });
});

describe('rewriteWorkerName', () => {
  const CONFIG_WITH_ROUTES = `{
  // Production worker
  "name": "api",
  "main": "src/index.ts",
  "workers_dev": false,
  "routes": ["myapp.com/*", "www.myapp.com/*"]
}`;

  const CONFIG_WITH_PATTERNS = `{
  "name": "api",
  "main": "src/index.ts",
  "patterns": ["myapp.com/*"]
}`;

  const CONFIG_WITH_CUSTOM_DOMAINS = `{
  "name": "api",
  "main": "src/index.ts",
  "custom_domains": ["myapp.com"]
}`;

  const PLAIN_CONFIG = `{
  "name": "api",
  "main": "src/index.ts"
}`;

  test('renames the worker', () => {
    const result = rewriteWorkerName(PLAIN_CONFIG, 'api-pr-42');
    const parsed = parseJsonc(result);
    expect(parsed.name).toBe('api-pr-42');
  });

  test('sets workers_dev to true', () => {
    const result = rewriteWorkerName(PLAIN_CONFIG, 'api-pr-42');
    const parsed = parseJsonc(result);
    expect(parsed.workers_dev).toBe(true);
  });

  test('overrides workers_dev: false to true', () => {
    const result = rewriteWorkerName(CONFIG_WITH_ROUTES, 'api-pr-42');
    const parsed = parseJsonc(result);
    expect(parsed.workers_dev).toBe(true);
  });

  test('removes routes to prevent conflict with production worker', () => {
    const result = rewriteWorkerName(CONFIG_WITH_ROUTES, 'api-pr-42');
    const parsed = parseJsonc(result);
    expect(parsed.routes).toBeUndefined();
  });

  test('removes patterns to prevent conflict with production worker', () => {
    const result = rewriteWorkerName(CONFIG_WITH_PATTERNS, 'api-pr-42');
    const parsed = parseJsonc(result);
    expect(parsed.patterns).toBeUndefined();
  });

  test('removes custom_domains to prevent conflict with production worker', () => {
    const result = rewriteWorkerName(CONFIG_WITH_CUSTOM_DOMAINS, 'api-pr-42');
    const parsed = parseJsonc(result);
    expect(parsed.custom_domains).toBeUndefined();
  });

  test('leaves config without routes unchanged (no routes key added)', () => {
    const result = rewriteWorkerName(PLAIN_CONFIG, 'api-pr-42');
    expect(result).not.toContain('routes');
    expect(result).not.toContain('patterns');
    expect(result).not.toContain('custom_domains');
  });

  test('preserves comments and other fields', () => {
    const result = rewriteWorkerName(CONFIG_WITH_ROUTES, 'api-pr-42');
    expect(result).toContain('// Production worker');
    expect(result).toContain('"main": "src/index.ts"');
  });
});

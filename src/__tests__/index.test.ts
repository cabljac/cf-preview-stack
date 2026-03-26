import { test, expect, describe, vi, beforeEach } from 'vitest';
import type { WorkerConfig, PreviewResult, DatabaseResult, KVNamespaceResult } from '../types.js';

// Mock @actions/core
const mockGetInput = vi.fn();
const mockGetBooleanInput = vi.fn();
const mockSetOutput = vi.fn();
const mockSetFailed = vi.fn();
const mockInfo = vi.fn();
const mockWarning = vi.fn();

vi.mock('@actions/core', () => ({
  getInput: (...args: unknown[]) => mockGetInput(...args),
  getBooleanInput: (...args: unknown[]) => mockGetBooleanInput(...args),
  setOutput: (...args: unknown[]) => mockSetOutput(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
  info: (...args: unknown[]) => mockInfo(...args),
  warning: (...args: unknown[]) => mockWarning(...args),
}));

// Mock @actions/github
vi.mock('@actions/github', () => ({
  context: {
    eventName: 'pull_request',
    payload: {
      action: 'opened',
      pull_request: { number: 42 },
    },
    repo: { owner: 'test-owner', repo: 'test-repo' },
  },
  getOctokit: vi.fn(),
}));

import * as github from '@actions/github';

// Mock cloudflare SDK
vi.mock('cloudflare', () => ({
  default: vi.fn().mockImplementation(() => ({})),
}));

// Mock all internal modules
vi.mock('../config.js', () => ({
  parseWorkersInput: vi.fn(),
}));

vi.mock('../wrangler.js', () => ({
  parseWranglerConfig: vi.fn(),
  rewriteWranglerConfig: vi.fn(),
  rewriteKVNamespaces: vi.fn(),
}));

vi.mock('../d1.js', () => ({
  createDatabase: vi.fn(),
}));

vi.mock('../kv.js', () => ({
  createKVNamespace: vi.fn(),
}));

vi.mock('../teardown.js', () => ({
  teardownDatabases: vi.fn(),
  teardownKVNamespaces: vi.fn(),
}));

vi.mock('../preview.js', () => ({
  runMigrations: vi.fn(),
  uploadPreviewVersion: vi.fn(),
}));

vi.mock('../comment.js', () => ({
  postPreviewComment: vi.fn(),
  postTeardownComment: vi.fn(),
}));

vi.mock('../cleanup.js', () => ({
  cleanupOrphanedDatabases: vi.fn(),
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

import { parseWorkersInput } from '../config.js';
import { parseWranglerConfig, rewriteWranglerConfig, rewriteKVNamespaces } from '../wrangler.js';
import { createDatabase } from '../d1.js';
import { createKVNamespace } from '../kv.js';
import { teardownDatabases, teardownKVNamespaces } from '../teardown.js';
import { runMigrations, uploadPreviewVersion } from '../preview.js';
import { postPreviewComment, postTeardownComment } from '../comment.js';
import { cleanupOrphanedDatabases } from '../cleanup.js';
import { readFileSync, writeFileSync } from 'node:fs';

const mockParseWorkersInput = vi.mocked(parseWorkersInput);
const mockParseWranglerConfig = vi.mocked(parseWranglerConfig);
const mockRewriteWranglerConfig = vi.mocked(rewriteWranglerConfig);
const mockRewriteKVNamespaces = vi.mocked(rewriteKVNamespaces);
const mockCreateDatabase = vi.mocked(createDatabase);
const mockCreateKVNamespace = vi.mocked(createKVNamespace);
const mockTeardownDatabases = vi.mocked(teardownDatabases);
const mockTeardownKVNamespaces = vi.mocked(teardownKVNamespaces);
const mockRunMigrations = vi.mocked(runMigrations);
const mockUploadPreviewVersion = vi.mocked(uploadPreviewVersion);
const mockPostPreviewComment = vi.mocked(postPreviewComment);
const mockPostTeardownComment = vi.mocked(postTeardownComment);
const mockCleanupOrphanedDatabases = vi.mocked(cleanupOrphanedDatabases);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);

function setupInputs(overrides: Record<string, string | boolean> = {}) {
  const defaults: Record<string, string | boolean> = {
    cloudflare_api_token: 'test-cf-token',
    cloudflare_account_id: 'test-account-id',
    workers: '- ./api/wrangler.jsonc',
    github_token: 'test-gh-token',
    comment: true,
    wrangler_version: 'latest',
    cleanup: false,
    ...overrides,
  };

  mockGetInput.mockImplementation((name: string) => {
    return String(defaults[name] ?? '');
  });
  mockGetBooleanInput.mockImplementation((name: string) => {
    return Boolean(defaults[name]);
  });
}

function setEventAction(action: string) {
  (github.context.payload as Record<string, unknown>).action = action;
}

function setupStandardMocks() {
  mockParseWorkersInput.mockReturnValue([
    { path: './api/wrangler.jsonc', workingDirectory: './api' },
  ]);
  mockReadFileSync.mockReturnValue('{"name":"api","d1_databases":[],"kv_namespaces":[]}');
  mockParseWranglerConfig.mockReturnValue({
    name: 'api',
    d1_databases: [
      { binding: 'DB', database_name: 'mydb', database_id: 'orig-uuid', migrations_dir: './migrations' },
    ],
    kv_namespaces: [],
  });
  mockTeardownDatabases.mockResolvedValue(['preview-pr-42-mydb']);
  mockTeardownKVNamespaces.mockResolvedValue([]);
  mockCreateDatabase.mockResolvedValue('new-uuid-123');
  mockRewriteWranglerConfig.mockReturnValue('{"name":"api","d1_databases":[{"binding":"DB","database_name":"preview-pr-42-mydb","database_id":"new-uuid-123"}]}');
  mockRunMigrations.mockResolvedValue(1);
  mockUploadPreviewVersion.mockResolvedValue({
    workerName: 'api',
    previewUrl: 'pr-42-api.example.workers.dev',
  });
  mockPostPreviewComment.mockResolvedValue(undefined);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  setEventAction('opened');
});

describe('index — orchestration', () => {
  test('on opened event: calls teardown → provision → migrate → upload → comment', async () => {
    setupInputs();
    setupStandardMocks();
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    // 1. Teardown first (both D1 and KV)
    expect(mockTeardownDatabases).toHaveBeenCalledWith(
      expect.anything(),
      'test-account-id',
      42,
    );
    expect(mockTeardownKVNamespaces).toHaveBeenCalledWith(
      expect.anything(),
      'test-account-id',
      42,
    );

    // 2. Provision: parse config, create database
    expect(mockParseWorkersInput).toHaveBeenCalledWith('- ./api/wrangler.jsonc');
    expect(mockReadFileSync).toHaveBeenCalled();
    expect(mockParseWranglerConfig).toHaveBeenCalled();
    expect(mockCreateDatabase).toHaveBeenCalledWith(
      expect.anything(),
      'test-account-id',
      'preview-pr-42-mydb',
    );

    // 3. Rewrite config and write to disk
    expect(mockRewriteWranglerConfig).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();

    // 4. Migrate
    expect(mockRunMigrations).toHaveBeenCalled();

    // 5. Upload
    expect(mockUploadPreviewVersion).toHaveBeenCalledWith(
      'api',
      './api',
      42,
      expect.objectContaining({ apiToken: 'test-cf-token', accountId: 'test-account-id' }),
      undefined,
    );

    // 6. Comment
    expect(mockPostPreviewComment).toHaveBeenCalled();

    // Verify order: teardown before create
    const teardownOrder = mockTeardownDatabases.mock.invocationCallOrder[0];
    const createOrder = mockCreateDatabase.mock.invocationCallOrder[0];
    const migrateOrder = mockRunMigrations.mock.invocationCallOrder[0];
    const uploadOrder = mockUploadPreviewVersion.mock.invocationCallOrder[0];
    expect(teardownOrder).toBeLessThan(createOrder);
    expect(createOrder).toBeLessThan(migrateOrder);
    expect(migrateOrder).toBeLessThan(uploadOrder);
  });

  test('on synchronize event: same as opened', async () => {
    setupInputs();
    setupStandardMocks();
    setEventAction('synchronize');

    const { run } = await import('../index.js');
    await run();

    expect(mockTeardownDatabases).toHaveBeenCalled();
    expect(mockTeardownKVNamespaces).toHaveBeenCalled();
    expect(mockCreateDatabase).toHaveBeenCalled();
    expect(mockRunMigrations).toHaveBeenCalled();
    expect(mockUploadPreviewVersion).toHaveBeenCalled();
    expect(mockPostPreviewComment).toHaveBeenCalled();
  });

  test('on reopened event: same as opened', async () => {
    setupInputs();
    setupStandardMocks();
    setEventAction('reopened');

    const { run } = await import('../index.js');
    await run();

    expect(mockTeardownDatabases).toHaveBeenCalled();
    expect(mockTeardownKVNamespaces).toHaveBeenCalled();
    expect(mockCreateDatabase).toHaveBeenCalled();
    expect(mockRunMigrations).toHaveBeenCalled();
    expect(mockUploadPreviewVersion).toHaveBeenCalled();
    expect(mockPostPreviewComment).toHaveBeenCalled();
  });

  test('on closed event: calls teardown for both D1 and KV → teardown comment', async () => {
    setupInputs();
    setEventAction('closed');
    mockTeardownDatabases.mockResolvedValue(['preview-pr-42-mydb']);
    mockTeardownKVNamespaces.mockResolvedValue(['preview-pr-42-MY_KV']);
    mockPostTeardownComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    expect(mockTeardownDatabases).toHaveBeenCalledWith(
      expect.anything(),
      'test-account-id',
      42,
    );
    expect(mockTeardownKVNamespaces).toHaveBeenCalledWith(
      expect.anything(),
      'test-account-id',
      42,
    );
    expect(mockPostTeardownComment).toHaveBeenCalledWith(
      'test-gh-token',
      { owner: 'test-owner', repo: 'test-repo' },
      42,
    );

    // Should NOT provision or upload
    expect(mockCreateDatabase).not.toHaveBeenCalled();
    expect(mockCreateKVNamespace).not.toHaveBeenCalled();
    expect(mockUploadPreviewVersion).not.toHaveBeenCalled();
    expect(mockPostPreviewComment).not.toHaveBeenCalled();
  });

  test('on cleanup: true — calls cleanup logic', async () => {
    setupInputs({ cleanup: true });
    mockCleanupOrphanedDatabases.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    expect(mockCleanupOrphanedDatabases).toHaveBeenCalledWith(
      expect.anything(),
      'test-account-id',
      'test-gh-token',
      { owner: 'test-owner', repo: 'test-repo' },
    );

    // Should NOT do normal lifecycle
    expect(mockTeardownDatabases).not.toHaveBeenCalled();
    expect(mockCreateDatabase).not.toHaveBeenCalled();
    expect(mockUploadPreviewVersion).not.toHaveBeenCalled();
  });

  test('sets outputs: preview_urls, database_ids, kv_namespace_ids, preview_alias', async () => {
    setupInputs();
    setupStandardMocks();
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    expect(mockSetOutput).toHaveBeenCalledWith(
      'preview_urls',
      expect.stringContaining('api'),
    );
    expect(mockSetOutput).toHaveBeenCalledWith(
      'database_ids',
      expect.stringContaining('new-uuid-123'),
    );
    expect(mockSetOutput).toHaveBeenCalledWith(
      'kv_namespace_ids',
      expect.any(String),
    );
    expect(mockSetOutput).toHaveBeenCalledWith('preview_alias', 'pr-42');
  });

  test('deduplicates D1 databases shared across workers (same database_name)', async () => {
    setupInputs({
      workers: '- ./api/wrangler.jsonc\n- ./web/wrangler.jsonc',
    });
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
      { path: './web/wrangler.jsonc', workingDirectory: './web' },
    ]);

    // Both workers share the same database_name "shared-db"
    mockReadFileSync.mockReturnValueOnce('{"name":"api"}').mockReturnValueOnce('{"name":"web"}');
    mockParseWranglerConfig
      .mockReturnValueOnce({
        name: 'api',
        d1_databases: [
          { binding: 'DB', database_name: 'shared-db', database_id: 'orig-1', migrations_dir: './migrations' },
        ],
        kv_namespaces: [],
      })
      .mockReturnValueOnce({
        name: 'web',
        d1_databases: [
          { binding: 'DB', database_name: 'shared-db', database_id: 'orig-2', migrations_dir: './migrations' },
        ],
        kv_namespaces: [],
      });

    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    // Only called once for "shared-db"
    mockCreateDatabase.mockResolvedValue('shared-uuid');
    mockRewriteWranglerConfig.mockReturnValue('rewritten');
    mockRunMigrations.mockResolvedValue(1);
    mockUploadPreviewVersion
      .mockResolvedValueOnce({ workerName: 'api', previewUrl: 'pr-42-api.example.workers.dev' })
      .mockResolvedValueOnce({ workerName: 'web', previewUrl: 'pr-42-web.example.workers.dev' });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // createDatabase should only be called ONCE for the shared database
    expect(mockCreateDatabase).toHaveBeenCalledTimes(1);
    expect(mockCreateDatabase).toHaveBeenCalledWith(
      expect.anything(),
      'test-account-id',
      'preview-pr-42-shared-db',
    );

    // Both workers should still be uploaded
    expect(mockUploadPreviewVersion).toHaveBeenCalledTimes(2);
  });

  test('handles worker with no D1 bindings (still uploads preview version)', async () => {
    setupInputs();
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
    ]);
    mockReadFileSync.mockReturnValue('{"name":"api"}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'api',
      d1_databases: [],
      kv_namespaces: [],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockRewriteWranglerConfig.mockReturnValue('{"name":"api"}');
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'api',
      previewUrl: 'pr-42-api.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // No databases created or migrated
    expect(mockCreateDatabase).not.toHaveBeenCalled();
    expect(mockRunMigrations).toHaveBeenCalledWith(
      [],
      './api',
      expect.anything(),
      undefined,
    );

    // Still uploads the preview version
    expect(mockUploadPreviewVersion).toHaveBeenCalledTimes(1);
  });

  test('skips commenting when comment input is false', async () => {
    setupInputs({ comment: false });
    setupStandardMocks();
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    expect(mockPostPreviewComment).not.toHaveBeenCalled();
  });

  test('skips teardown comment when comment input is false on closed event', async () => {
    setupInputs({ comment: false });
    setEventAction('closed');
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);

    const { run } = await import('../index.js');
    await run();

    expect(mockTeardownDatabases).toHaveBeenCalled();
    expect(mockTeardownKVNamespaces).toHaveBeenCalled();
    expect(mockPostTeardownComment).not.toHaveBeenCalled();
  });

  test('calls setFailed on error', async () => {
    setupInputs();
    setEventAction('opened');
    mockParseWorkersInput.mockImplementation(() => {
      throw new Error('bad input');
    });

    const { run } = await import('../index.js');
    await run();

    expect(mockSetFailed).toHaveBeenCalledWith('bad input');
  });

  test('fails if PR number is missing from payload', async () => {
    setupInputs();
    setEventAction('opened');
    (github.context.payload as Record<string, unknown>).pull_request = undefined;

    const { run } = await import('../index.js');
    await run();

    expect(mockSetFailed).toHaveBeenCalledWith('No pull request number found in event payload');

    // Restore for other tests
    (github.context.payload as Record<string, unknown>).pull_request = { number: 42 };
  });

  test('ignores unsupported action types', async () => {
    setupInputs();
    setEventAction('labeled');

    const { run } = await import('../index.js');
    await run();

    expect(mockTeardownDatabases).not.toHaveBeenCalled();
    expect(mockCreateDatabase).not.toHaveBeenCalled();
    expect(mockUploadPreviewVersion).not.toHaveBeenCalled();
    expect(mockInfo).toHaveBeenCalledWith('Ignoring unsupported action: labeled');
  });

  test('does not rewrite config for worker with no D1 or KV bindings', async () => {
    setupInputs();
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
    ]);
    mockReadFileSync.mockReturnValue('{"name":"api"}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'api',
      d1_databases: [],
      kv_namespaces: [],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'api',
      previewUrl: 'pr-42-api.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    expect(mockWriteFileSync).not.toHaveBeenCalled();
    expect(mockRewriteWranglerConfig).not.toHaveBeenCalled();
    expect(mockRewriteKVNamespaces).not.toHaveBeenCalled();
  });

  test('skips duplicate migrations for shared databases across workers', async () => {
    setupInputs({
      workers: '- ./api/wrangler.jsonc\n- ./web/wrangler.jsonc',
    });
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
      { path: './web/wrangler.jsonc', workingDirectory: './web' },
    ]);
    mockReadFileSync.mockReturnValueOnce('{"name":"api"}').mockReturnValueOnce('{"name":"web"}');
    mockParseWranglerConfig
      .mockReturnValueOnce({
        name: 'api',
        d1_databases: [
          { binding: 'DB', database_name: 'shared-db', database_id: 'orig-1', migrations_dir: './migrations' },
        ],
        kv_namespaces: [],
      })
      .mockReturnValueOnce({
        name: 'web',
        d1_databases: [
          { binding: 'DB', database_name: 'shared-db', database_id: 'orig-2', migrations_dir: './migrations' },
        ],
        kv_namespaces: [],
      });

    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockCreateDatabase.mockResolvedValue('shared-uuid');
    mockRewriteWranglerConfig.mockReturnValue('rewritten');
    mockRunMigrations.mockResolvedValue(1);
    mockUploadPreviewVersion
      .mockResolvedValueOnce({ workerName: 'api', previewUrl: 'pr-42-api.example.workers.dev' })
      .mockResolvedValueOnce({ workerName: 'web', previewUrl: 'pr-42-web.example.workers.dev' });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // First worker should run migrations with the shared-db binding
    const firstMigrationBindings = mockRunMigrations.mock.calls[0][0];
    expect(firstMigrationBindings).toHaveLength(1);
    expect(firstMigrationBindings[0].database_name).toBe('preview-pr-42-shared-db');

    // Second worker should get empty bindings (already migrated)
    const secondMigrationBindings = mockRunMigrations.mock.calls[1][0];
    expect(secondMigrationBindings).toHaveLength(0);
  });
});

describe('index — deploy_config (Vite plugin) support', () => {
  test('reads and rewrites deploy_config instead of source config when set', async () => {
    setupInputs();
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      {
        path: 'apps/analytics/wrangler.jsonc',
        workingDirectory: 'apps/analytics',
        deployConfig: 'apps/analytics/dist/out/wrangler.json',
      },
    ]);
    // Should read from deploy_config path
    mockReadFileSync.mockReturnValue('{"name":"analytics","d1_databases":[],"kv_namespaces":[]}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'analytics',
      d1_databases: [],
      kv_namespaces: [],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'analytics',
      previewUrl: 'pr-42-analytics.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // Should read from deploy_config, not source path
    expect(mockReadFileSync).toHaveBeenCalledWith(
      'apps/analytics/dist/out/wrangler.json',
      'utf-8',
    );

    // Should pass deploy_config to upload and migrations
    expect(mockUploadPreviewVersion).toHaveBeenCalledWith(
      'analytics',
      'apps/analytics',
      42,
      expect.anything(),
      'apps/analytics/dist/out/wrangler.json',
    );
    expect(mockRunMigrations).toHaveBeenCalledWith(
      expect.anything(),
      'apps/analytics',
      expect.anything(),
      'apps/analytics/dist/out/wrangler.json',
    );
  });

  test('rewrites deploy_config file on disk when bindings need updating', async () => {
    setupInputs();
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      {
        path: 'apps/analytics/wrangler.jsonc',
        workingDirectory: 'apps/analytics',
        deployConfig: 'apps/analytics/dist/out/wrangler.json',
      },
    ]);
    mockReadFileSync.mockReturnValue('{"name":"analytics"}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'analytics',
      d1_databases: [
        { binding: 'DB', database_name: 'mydb', database_id: 'orig-uuid', migrations_dir: './migrations' },
      ],
      kv_namespaces: [],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockCreateDatabase.mockResolvedValue('new-uuid');
    mockRewriteWranglerConfig.mockReturnValue('{"name":"analytics","rewritten":true}');
    mockRunMigrations.mockResolvedValue(1);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'analytics',
      previewUrl: 'pr-42-analytics.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // Should write to deploy_config, not source path
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      'apps/analytics/dist/out/wrangler.json',
      expect.any(String),
      'utf-8',
    );
  });
});

describe('index — KV namespace orchestration', () => {
  test('provisions KV namespaces alongside D1 databases', async () => {
    setupInputs();
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
    ]);
    mockReadFileSync.mockReturnValue('{"name":"api"}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'api',
      d1_databases: [
        { binding: 'DB', database_name: 'mydb', database_id: 'orig-uuid', migrations_dir: './migrations' },
      ],
      kv_namespaces: [
        { binding: 'MY_KV', id: 'orig-kv-id' },
      ],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockCreateDatabase.mockResolvedValue('new-db-uuid');
    mockCreateKVNamespace.mockResolvedValue('new-kv-id');
    mockRewriteWranglerConfig.mockReturnValue('rewritten-d1');
    mockRewriteKVNamespaces.mockReturnValue('rewritten-d1-and-kv');
    mockRunMigrations.mockResolvedValue(1);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'api',
      previewUrl: 'pr-42-api.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // Should create both D1 database and KV namespace
    expect(mockCreateDatabase).toHaveBeenCalledWith(
      expect.anything(),
      'test-account-id',
      'preview-pr-42-mydb',
    );
    expect(mockCreateKVNamespace).toHaveBeenCalledWith(
      expect.anything(),
      'test-account-id',
      'preview-pr-42-MY_KV',
    );

    // Should rewrite both D1 and KV
    expect(mockRewriteWranglerConfig).toHaveBeenCalled();
    expect(mockRewriteKVNamespaces).toHaveBeenCalled();

    // Should write rewritten config
    expect(mockWriteFileSync).toHaveBeenCalled();

    // Should set kv_namespace_ids output
    expect(mockSetOutput).toHaveBeenCalledWith(
      'kv_namespace_ids',
      expect.stringContaining('new-kv-id'),
    );
  });

  test('deduplicates KV namespaces by original id across workers', async () => {
    setupInputs({
      workers: '- ./api/wrangler.jsonc\n- ./web/wrangler.jsonc',
    });
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
      { path: './web/wrangler.jsonc', workingDirectory: './web' },
    ]);
    mockReadFileSync.mockReturnValueOnce('{"name":"api"}').mockReturnValueOnce('{"name":"web"}');
    mockParseWranglerConfig
      .mockReturnValueOnce({
        name: 'api',
        d1_databases: [],
        kv_namespaces: [
          { binding: 'SHARED_KV', id: 'shared-kv-id' },
        ],
      })
      .mockReturnValueOnce({
        name: 'web',
        d1_databases: [],
        kv_namespaces: [
          { binding: 'SHARED_KV', id: 'shared-kv-id' },
        ],
      });

    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockCreateKVNamespace.mockResolvedValue('preview-kv-id');
    mockRewriteKVNamespaces.mockReturnValue('rewritten');
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion
      .mockResolvedValueOnce({ workerName: 'api', previewUrl: 'pr-42-api.example.workers.dev' })
      .mockResolvedValueOnce({ workerName: 'web', previewUrl: 'pr-42-web.example.workers.dev' });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // Should only create one KV namespace despite two workers sharing the same id
    expect(mockCreateKVNamespace).toHaveBeenCalledTimes(1);
    expect(mockUploadPreviewVersion).toHaveBeenCalledTimes(2);
  });

  test('worker with KV but no D1 still provisions KV and uploads', async () => {
    setupInputs();
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
    ]);
    mockReadFileSync.mockReturnValue('{"name":"api"}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'api',
      d1_databases: [],
      kv_namespaces: [
        { binding: 'MY_KV', id: 'orig-kv-id' },
      ],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockCreateKVNamespace.mockResolvedValue('new-kv-id');
    mockRewriteKVNamespaces.mockReturnValue('rewritten');
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'api',
      previewUrl: 'pr-42-api.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    expect(mockCreateDatabase).not.toHaveBeenCalled();
    expect(mockCreateKVNamespace).toHaveBeenCalledTimes(1);
    expect(mockUploadPreviewVersion).toHaveBeenCalledTimes(1);
  });

  test('passes KV results to comment function', async () => {
    setupInputs();
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
    ]);
    mockReadFileSync.mockReturnValue('{"name":"api"}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'api',
      d1_databases: [],
      kv_namespaces: [
        { binding: 'MY_KV', id: 'orig-kv-id' },
      ],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockCreateKVNamespace.mockResolvedValue('new-kv-id');
    mockRewriteKVNamespaces.mockReturnValue('rewritten');
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'api',
      previewUrl: 'pr-42-api.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // postPreviewComment should be called with KV results as the 6th argument
    expect(mockPostPreviewComment).toHaveBeenCalledWith(
      'test-gh-token',
      { owner: 'test-owner', repo: 'test-repo' },
      42,
      expect.any(Array), // previews
      expect.any(Array), // databases
      expect.arrayContaining([
        expect.objectContaining({
          bindingName: 'MY_KV',
          originalId: 'orig-kv-id',
          previewTitle: 'preview-pr-42-MY_KV',
          previewId: 'new-kv-id',
        }),
      ]),
    );
  });
});

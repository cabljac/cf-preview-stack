import { test, expect, describe, vi, beforeEach } from 'vitest';
import type { WorkerConfig, PreviewResult, DatabaseResult, KVNamespaceResult } from '../types.js';

// Mock @actions/core
const mockGetInput = vi.fn();
const mockGetBooleanInput = vi.fn();
const mockSetOutput = vi.fn();
const mockSetFailed = vi.fn();
const mockInfo = vi.fn();
const mockWarning = vi.fn();
const mockSetSecret = vi.fn();

vi.mock('@actions/core', () => ({
  getInput: (...args: unknown[]) => mockGetInput(...args),
  getBooleanInput: (...args: unknown[]) => mockGetBooleanInput(...args),
  setOutput: (...args: unknown[]) => mockSetOutput(...args),
  setFailed: (...args: unknown[]) => mockSetFailed(...args),
  info: (...args: unknown[]) => mockInfo(...args),
  warning: (...args: unknown[]) => mockWarning(...args),
  setSecret: (...args: unknown[]) => mockSetSecret(...args),
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
  rewriteWorkflowNames: vi.fn(),
  rewriteVars: vi.fn(),
  rewriteWorkerName: vi.fn(),
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
  teardownWorkers: vi.fn(),
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
  mkdtempSync: vi.fn().mockReturnValue('/tmp/cf-preview-test'),
  rmSync: vi.fn(),
}));

import { parseWorkersInput } from '../config.js';
import { parseWranglerConfig, rewriteWranglerConfig, rewriteKVNamespaces, rewriteWorkflowNames, rewriteVars, rewriteWorkerName } from '../wrangler.js';
import { createDatabase } from '../d1.js';
import { createKVNamespace } from '../kv.js';
import { teardownDatabases, teardownKVNamespaces, teardownWorkers } from '../teardown.js';
import { runMigrations, uploadPreviewVersion } from '../preview.js';
import { postPreviewComment, postTeardownComment } from '../comment.js';
import { cleanupOrphanedDatabases } from '../cleanup.js';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';

const mockParseWorkersInput = vi.mocked(parseWorkersInput);
const mockParseWranglerConfig = vi.mocked(parseWranglerConfig);
const mockRewriteWranglerConfig = vi.mocked(rewriteWranglerConfig);
const mockRewriteKVNamespaces = vi.mocked(rewriteKVNamespaces);
const mockRewriteWorkflowNames = vi.mocked(rewriteWorkflowNames);
const mockRewriteVars = vi.mocked(rewriteVars);
const mockRewriteWorkerName = vi.mocked(rewriteWorkerName);
const mockCreateDatabase = vi.mocked(createDatabase);
const mockCreateKVNamespace = vi.mocked(createKVNamespace);
const mockTeardownDatabases = vi.mocked(teardownDatabases);
const mockTeardownKVNamespaces = vi.mocked(teardownKVNamespaces);
const mockTeardownWorkers = vi.mocked(teardownWorkers);
const mockRunMigrations = vi.mocked(runMigrations);
const mockUploadPreviewVersion = vi.mocked(uploadPreviewVersion);
const mockPostPreviewComment = vi.mocked(postPreviewComment);
const mockPostTeardownComment = vi.mocked(postTeardownComment);
const mockCleanupOrphanedDatabases = vi.mocked(cleanupOrphanedDatabases);
const mockReadFileSync = vi.mocked(readFileSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockMkdtempSync = vi.mocked(mkdtempSync);
const mockRmSync = vi.mocked(rmSync);

function setupInputs(overrides: Record<string, string | boolean> = {}) {
  const defaults: Record<string, string | boolean> = {
    cloudflare_api_token: 'test-cf-token',
    cloudflare_account_id: 'test-account-id',
    workers: '- ./api/wrangler.jsonc',
    github_token: 'test-gh-token',
    comment: true,
    wrangler_version: 'latest',
    cleanup: false,
    secrets: '{}',
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
    workflows: [],
  });
  mockTeardownDatabases.mockResolvedValue(['preview-pr-42-mydb']);
  mockTeardownKVNamespaces.mockResolvedValue([]);
  mockTeardownWorkers.mockResolvedValue(undefined);
  mockCreateDatabase.mockResolvedValue('new-uuid-123');
  mockRewriteWranglerConfig.mockReturnValue('{"name":"api","d1_databases":[{"binding":"DB","database_name":"preview-pr-42-mydb","database_id":"new-uuid-123"}]}');
  mockRewriteWorkerName.mockReturnValue('{"name":"api-pr-42","workers_dev":true,"d1_databases":[]}');
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

    // 3. Rewrite config and write to disk — worker name is always rewritten to isolate from production
    expect(mockRewriteWranglerConfig).toHaveBeenCalled();
    expect(mockRewriteWorkerName).toHaveBeenCalledWith(expect.any(String), 'api-pr-42');
    expect(mockWriteFileSync).toHaveBeenCalled();

    // 4. Migrate
    expect(mockRunMigrations).toHaveBeenCalled();

    // 5. Upload (receives temp config path)
    expect(mockUploadPreviewVersion).toHaveBeenCalledWith(
      'api',
      './api',
      42,
      expect.objectContaining({ apiToken: 'test-cf-token', accountId: 'test-account-id' }),
      '/tmp/cf-preview-test/0-wrangler.jsonc',
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

  test('on closed event: calls teardown for D1, KV, and workers → teardown comment', async () => {
    setupInputs();
    setEventAction('closed');
    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
    ]);
    mockTeardownDatabases.mockResolvedValue(['preview-pr-42-mydb']);
    mockTeardownKVNamespaces.mockResolvedValue(['preview-pr-42-MY_KV']);
    mockTeardownWorkers.mockResolvedValue(undefined);
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
    expect(mockTeardownWorkers).toHaveBeenCalledWith(
      expect.any(Array),
      42,
      expect.objectContaining({ apiToken: 'test-cf-token', accountId: 'test-account-id' }),
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
        workflows: [],
      })
      .mockReturnValueOnce({
        name: 'web',
        d1_databases: [
          { binding: 'DB', database_name: 'shared-db', database_id: 'orig-2', migrations_dir: './migrations' },
        ],
        kv_namespaces: [],
        workflows: [],
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
      workflows: [],
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
      '/tmp/cf-preview-test/0-wrangler.jsonc',
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

  test('does not rewrite config for worker with no D1, KV, or workflow bindings', async () => {
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
      workflows: [],
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

    // rewriteWorkerName always runs so writeFileSync is always called
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(mockRewriteWorkerName).toHaveBeenCalledWith(expect.any(String), 'api-pr-42');
    // No D1/KV/workflow rewrites needed
    expect(mockRewriteWranglerConfig).not.toHaveBeenCalled();
    expect(mockRewriteKVNamespaces).not.toHaveBeenCalled();
    expect(mockRewriteWorkflowNames).not.toHaveBeenCalled();
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
        workflows: [],
      })
      .mockReturnValueOnce({
        name: 'web',
        d1_databases: [
          { binding: 'DB', database_name: 'shared-db', database_id: 'orig-2', migrations_dir: './migrations' },
        ],
        kv_namespaces: [],
        workflows: [],
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
      workflows: [],
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

    // Should pass temp config path to upload and migrations
    expect(mockUploadPreviewVersion).toHaveBeenCalledWith(
      'analytics',
      'apps/analytics',
      42,
      expect.anything(),
      '/tmp/cf-preview-test/0-wrangler.json',
    );
    expect(mockRunMigrations).toHaveBeenCalledWith(
      expect.anything(),
      'apps/analytics',
      expect.anything(),
      '/tmp/cf-preview-test/0-wrangler.json',
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
      workflows: [],
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

    // Should write to temp file, not the original config path
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      '/tmp/cf-preview-test/0-wrangler.json',
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
      workflows: [],
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
        workflows: [],
      })
      .mockReturnValueOnce({
        name: 'web',
        d1_databases: [],
        kv_namespaces: [
          { binding: 'SHARED_KV', id: 'shared-kv-id' },
        ],
        workflows: [],
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
      workflows: [],
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
      workflows: [],
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

describe('index — workflow orchestration', () => {
  test('rewrites workflow names in config', async () => {
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
      workflows: [
        { binding: 'MY_WORKFLOW', name: 'my-workflow', class_name: 'MyWorkflow' },
      ],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockRewriteWorkflowNames.mockReturnValue('rewritten-wf');
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'api',
      previewUrl: 'pr-42-api.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    expect(mockRewriteWorkflowNames).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(mockUploadPreviewVersion).toHaveBeenCalledTimes(1);
  });

  test('deduplicates workflow names across workers', async () => {
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
        kv_namespaces: [],
        workflows: [
          { binding: 'GENERATE_COURSE', name: 'generate-course-workflow', class_name: 'GenerateCourseWorkflow' },
        ],
      })
      .mockReturnValueOnce({
        name: 'web',
        d1_databases: [],
        kv_namespaces: [],
        workflows: [
          { binding: 'GENERATE_COURSE', name: 'generate-course-workflow', script_name: 'course-generation' },
        ],
      });

    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockRewriteWorkflowNames.mockReturnValue('rewritten');
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion
      .mockResolvedValueOnce({ workerName: 'api', previewUrl: 'pr-42-api.example.workers.dev' })
      .mockResolvedValueOnce({ workerName: 'web', previewUrl: 'pr-42-web.example.workers.dev' });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // Both workers should get workflow names rewritten
    expect(mockRewriteWorkflowNames).toHaveBeenCalledTimes(2);
    expect(mockUploadPreviewVersion).toHaveBeenCalledTimes(2);
  });

  test('worker with only workflows (no D1/KV) still rewrites and uploads', async () => {
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
      workflows: [
        { binding: 'DELETE_ACCOUNT', name: 'delete-account-workflow', class_name: 'DeleteAccountWorkflow' },
      ],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockRewriteWorkflowNames.mockReturnValue('rewritten-wf');
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'api',
      previewUrl: 'pr-42-api.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    expect(mockCreateDatabase).not.toHaveBeenCalled();
    expect(mockCreateKVNamespace).not.toHaveBeenCalled();
    expect(mockRewriteWorkflowNames).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalled();
    expect(mockUploadPreviewVersion).toHaveBeenCalledTimes(1);
  });

  test('does not call rewriteWorkflowNames when no workflows present', async () => {
    setupInputs();
    setupStandardMocks();
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    expect(mockRewriteWorkflowNames).not.toHaveBeenCalled();
  });
});

describe('index — secrets (vars) injection', () => {
  test('parses secrets input and calls rewriteVars', async () => {
    setupInputs({ secrets: '{"AUTH_SECRET":"test123","API_KEY":"key456"}' });
    setupStandardMocks();
    mockRewriteVars.mockReturnValue('rewritten-with-vars');
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    expect(mockRewriteVars).toHaveBeenCalledWith(
      expect.any(String),
      { AUTH_SECRET: 'test123', API_KEY: 'key456' },
    );
  });

  test('skips rewriteVars when secrets is empty {}', async () => {
    setupInputs({ secrets: '{}' });
    setupStandardMocks();
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    expect(mockRewriteVars).not.toHaveBeenCalled();
  });

  test('applies secrets to all workers', async () => {
    setupInputs({
      workers: '- ./api/wrangler.jsonc\n- ./web/wrangler.jsonc',
      secrets: '{"AUTH_SECRET":"shared-secret"}',
    });
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
      { path: './web/wrangler.jsonc', workingDirectory: './web' },
    ]);
    mockReadFileSync.mockReturnValueOnce('{"name":"api"}').mockReturnValueOnce('{"name":"web"}');
    mockParseWranglerConfig
      .mockReturnValueOnce({ name: 'api', d1_databases: [], kv_namespaces: [], workflows: [] })
      .mockReturnValueOnce({ name: 'web', d1_databases: [], kv_namespaces: [], workflows: [] });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockRewriteVars.mockReturnValue('rewritten-with-vars');
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion
      .mockResolvedValueOnce({ workerName: 'api', previewUrl: 'pr-42-api.example.workers.dev' })
      .mockResolvedValueOnce({ workerName: 'web', previewUrl: 'pr-42-web.example.workers.dev' });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    expect(mockRewriteVars).toHaveBeenCalledTimes(2);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
  });

  test('writes config when only secrets change (no D1/KV/workflow bindings)', async () => {
    setupInputs({ secrets: '{"AUTH_SECRET":"preview-secret"}' });
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
    ]);
    mockReadFileSync.mockReturnValue('{"name":"api"}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'api',
      d1_databases: [],
      kv_namespaces: [],
      workflows: [],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockTeardownKVNamespaces.mockResolvedValue([]);
    mockRewriteVars.mockReturnValue('{"name":"api","vars":{"AUTH_SECRET":"preview-secret"}}');
    mockRunMigrations.mockResolvedValue(0);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'api',
      previewUrl: 'pr-42-api.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    expect(mockRewriteVars).toHaveBeenCalledTimes(1);
    expect(mockWriteFileSync).toHaveBeenCalledTimes(1);
  });

  test('masks secret values via core.setSecret', async () => {
    setupInputs({ secrets: '{"AUTH_SECRET":"s3cret","API_KEY":"k3y"}' });
    setupStandardMocks();
    mockRewriteVars.mockReturnValue('rewritten');
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    expect(mockSetSecret).toHaveBeenCalledWith('s3cret');
    expect(mockSetSecret).toHaveBeenCalledWith('k3y');
  });
});

describe('index — temp file isolation', () => {
  test('writes rewritten config to temp file, never mutates original', async () => {
    setupInputs();
    setupStandardMocks();
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    // Should write to temp dir, not the original config path
    const writeCalls = mockWriteFileSync.mock.calls;
    for (const [path] of writeCalls) {
      expect(path).toMatch(/^\/tmp\/cf-preview-test\//);
      expect(path).not.toBe('./api/wrangler.jsonc');
    }
  });

  test('cleans up temp directory after deployment', async () => {
    setupInputs();
    setupStandardMocks();
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    expect(mockRmSync).toHaveBeenCalledWith('/tmp/cf-preview-test', { recursive: true, force: true });
  });

  test('passes temp config path to runMigrations and uploadPreviewVersion', async () => {
    setupInputs();
    setupStandardMocks();
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    expect(mockRunMigrations).toHaveBeenCalledWith(
      expect.anything(),
      './api',
      expect.anything(),
      '/tmp/cf-preview-test/0-wrangler.jsonc',
    );
    expect(mockUploadPreviewVersion).toHaveBeenCalledWith(
      'api',
      './api',
      42,
      expect.anything(),
      '/tmp/cf-preview-test/0-wrangler.jsonc',
    );
  });
});

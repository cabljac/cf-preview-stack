import { test, expect, describe, vi, beforeEach } from 'vitest';
import type { WorkerConfig, PreviewResult, DatabaseResult } from '../types.js';

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
}));

vi.mock('../d1.js', () => ({
  createDatabase: vi.fn(),
}));

vi.mock('../teardown.js', () => ({
  teardownDatabases: vi.fn(),
}));

vi.mock('../preview.js', () => ({
  runMigrations: vi.fn(),
  runCustomMigration: vi.fn(),
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
import { parseWranglerConfig, rewriteWranglerConfig } from '../wrangler.js';
import { createDatabase } from '../d1.js';
import { teardownDatabases } from '../teardown.js';
import { runMigrations, runCustomMigration, uploadPreviewVersion } from '../preview.js';
import { postPreviewComment, postTeardownComment } from '../comment.js';
import { cleanupOrphanedDatabases } from '../cleanup.js';
import { readFileSync, writeFileSync } from 'node:fs';

const mockParseWorkersInput = vi.mocked(parseWorkersInput);
const mockParseWranglerConfig = vi.mocked(parseWranglerConfig);
const mockRewriteWranglerConfig = vi.mocked(rewriteWranglerConfig);
const mockCreateDatabase = vi.mocked(createDatabase);
const mockTeardownDatabases = vi.mocked(teardownDatabases);
const mockRunMigrations = vi.mocked(runMigrations);
const mockRunCustomMigration = vi.mocked(runCustomMigration);
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
  mockReadFileSync.mockReturnValue('{"name":"api","d1_databases":[]}');
  mockParseWranglerConfig.mockReturnValue({
    name: 'api',
    d1_databases: [
      { binding: 'DB', database_name: 'mydb', database_id: 'orig-uuid', migrations_dir: './migrations' },
    ],
  });
  mockTeardownDatabases.mockResolvedValue(['preview-pr-42-mydb']);
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

    // 1. Teardown first
    expect(mockTeardownDatabases).toHaveBeenCalledWith(
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
    expect(mockCreateDatabase).toHaveBeenCalled();
    expect(mockRunMigrations).toHaveBeenCalled();
    expect(mockUploadPreviewVersion).toHaveBeenCalled();
    expect(mockPostPreviewComment).toHaveBeenCalled();
  });

  test('on closed event: calls teardown → teardown comment', async () => {
    setupInputs();
    setEventAction('closed');
    mockTeardownDatabases.mockResolvedValue(['preview-pr-42-mydb']);
    mockPostTeardownComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    expect(mockTeardownDatabases).toHaveBeenCalledWith(
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

  test('sets outputs: preview_urls, database_ids, preview_alias', async () => {
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
      })
      .mockReturnValueOnce({
        name: 'web',
        d1_databases: [
          { binding: 'DB', database_name: 'shared-db', database_id: 'orig-2', migrations_dir: './migrations' },
        ],
      });

    mockTeardownDatabases.mockResolvedValue([]);
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
    });
    mockTeardownDatabases.mockResolvedValue([]);
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

    const { run } = await import('../index.js');
    await run();

    expect(mockTeardownDatabases).toHaveBeenCalled();
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

  test('does not rewrite config for worker with no D1 bindings', async () => {
    setupInputs();
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api' },
    ]);
    mockReadFileSync.mockReturnValue('{"name":"api"}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'api',
      d1_databases: [],
    });
    mockTeardownDatabases.mockResolvedValue([]);
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
  });

  test('uses custom migration command instead of runMigrations when migrationCommand is set', async () => {
    setupInputs();
    setEventAction('opened');

    mockParseWorkersInput.mockReturnValue([
      { path: './api/wrangler.jsonc', workingDirectory: './api', migrationCommand: 'npx drizzle-kit push' },
    ]);
    mockReadFileSync.mockReturnValue('{"name":"api","d1_databases":[]}');
    mockParseWranglerConfig.mockReturnValue({
      name: 'api',
      d1_databases: [
        { binding: 'DB', database_name: 'mydb', database_id: 'orig-uuid', migrations_dir: './migrations' },
      ],
    });
    mockTeardownDatabases.mockResolvedValue([]);
    mockCreateDatabase.mockResolvedValue('new-uuid-123');
    mockRewriteWranglerConfig.mockReturnValue('rewritten');
    mockRunCustomMigration.mockResolvedValue(undefined);
    mockUploadPreviewVersion.mockResolvedValue({
      workerName: 'api',
      previewUrl: 'pr-42-api.example.workers.dev',
    });
    mockPostPreviewComment.mockResolvedValue(undefined);

    const { run } = await import('../index.js');
    await run();

    // Should use custom migration command, NOT runMigrations
    expect(mockRunCustomMigration).toHaveBeenCalledWith(
      'npx drizzle-kit push',
      './api',
      expect.objectContaining({ apiToken: 'test-cf-token', accountId: 'test-account-id' }),
    );
    expect(mockRunMigrations).not.toHaveBeenCalled();
  });

  test('uses runMigrations when migrationCommand is not set', async () => {
    setupInputs();
    setupStandardMocks();
    setEventAction('opened');

    const { run } = await import('../index.js');
    await run();

    expect(mockRunMigrations).toHaveBeenCalled();
    expect(mockRunCustomMigration).not.toHaveBeenCalled();
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
      })
      .mockReturnValueOnce({
        name: 'web',
        d1_databases: [
          { binding: 'DB', database_name: 'shared-db', database_id: 'orig-2', migrations_dir: './migrations' },
        ],
      });

    mockTeardownDatabases.mockResolvedValue([]);
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

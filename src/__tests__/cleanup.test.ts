import { test, expect, describe, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import * as core from '@actions/core';
import { cleanupOrphanedDatabases } from '../cleanup.js';
import * as d1 from '../d1.js';
import * as kv from '../kv.js';

vi.mock('../d1.js', () => ({
  listPreviewDatabases: vi.fn(),
  deleteDatabase: vi.fn(),
}));

vi.mock('../kv.js', () => ({
  listPreviewKVNamespaces: vi.fn(),
  deleteKVNamespace: vi.fn(),
}));

const mockDelete = vi.mocked(d1.deleteDatabase);
const mockKVDelete = vi.mocked(kv.deleteKVNamespace);

const ACCOUNT_ID = 'test-account-123';

function makeMockClient(kvNamespaces: Array<{ id: string; title: string }> = []) {
  return {
    d1: {
      database: {
        list: vi.fn(),
      },
    },
    kv: {
      namespaces: {
        list: vi.fn().mockReturnValue(asyncIterable(kvNamespaces)),
      },
    },
  } as unknown as import('cloudflare').default;
}

/** Helper to make an async iterable from an array. */
function asyncIterable<T>(items: T[]) {
  return {
    [Symbol.asyncIterator]() {
      let i = 0;
      return {
        next: async () =>
          i < items.length
            ? { value: items[i++], done: false as const }
            : { value: undefined, done: true as const },
      };
    },
  };
}

const mockGetPullRequest = vi.fn();

vi.mock('@actions/github', () => ({
  getOctokit: () => ({
    rest: {
      pulls: {
        get: mockGetPullRequest,
      },
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const REPO = { owner: 'test-owner', repo: 'test-repo' };

describe('cleanupOrphanedDatabases', () => {
  test('extracts unique PR numbers from database names', async () => {
    const client = makeMockClient();
    (client.d1.database.list as ReturnType<typeof vi.fn>).mockReturnValue(
      asyncIterable([
        { uuid: 'uuid-1', name: 'preview-pr-10-mydb' },
        { uuid: 'uuid-2', name: 'preview-pr-10-cache' },
        { uuid: 'uuid-3', name: 'preview-pr-20-mydb' },
        { uuid: 'uuid-4', name: 'production-db' },
      ]),
    );

    mockGetPullRequest.mockResolvedValue({ data: { state: 'open' } });

    await cleanupOrphanedDatabases(client, ACCOUNT_ID, 'fake-token', REPO);

    // Should check PR 10 and PR 20 only
    expect(mockGetPullRequest).toHaveBeenCalledTimes(2);
  });

  test('checks each PR open/closed status via GitHub API', async () => {
    const client = makeMockClient();
    (client.d1.database.list as ReturnType<typeof vi.fn>).mockReturnValue(
      asyncIterable([
        { uuid: 'uuid-1', name: 'preview-pr-5-db1' },
        { uuid: 'uuid-2', name: 'preview-pr-8-db1' },
      ]),
    );

    mockGetPullRequest
      .mockResolvedValueOnce({ data: { state: 'closed' } })
      .mockResolvedValueOnce({ data: { state: 'open' } });

    mockDelete.mockResolvedValue(undefined);

    await cleanupOrphanedDatabases(client, ACCOUNT_ID, 'fake-token', REPO);

    expect(mockGetPullRequest).toHaveBeenCalledWith({
      ...REPO,
      pull_number: 5,
    });
    expect(mockGetPullRequest).toHaveBeenCalledWith({
      ...REPO,
      pull_number: 8,
    });
  });

  test('deletes databases for closed/merged PRs only', async () => {
    const client = makeMockClient();
    (client.d1.database.list as ReturnType<typeof vi.fn>).mockReturnValue(
      asyncIterable([
        { uuid: 'uuid-1', name: 'preview-pr-5-db1' },
        { uuid: 'uuid-2', name: 'preview-pr-5-db2' },
        { uuid: 'uuid-3', name: 'preview-pr-8-db1' },
      ]),
    );

    mockGetPullRequest
      .mockResolvedValueOnce({ data: { state: 'closed' } })  // PR 5 is closed
      .mockResolvedValueOnce({ data: { state: 'open' } });   // PR 8 is open

    mockDelete.mockResolvedValue(undefined);

    await cleanupOrphanedDatabases(client, ACCOUNT_ID, 'fake-token', REPO);

    // Should only delete databases for PR 5 (closed)
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledWith(client, ACCOUNT_ID, 'uuid-1');
    expect(mockDelete).toHaveBeenCalledWith(client, ACCOUNT_ID, 'uuid-2');
  });

  test('leaves databases for open PRs untouched', async () => {
    const client = makeMockClient();
    (client.d1.database.list as ReturnType<typeof vi.fn>).mockReturnValue(
      asyncIterable([
        { uuid: 'uuid-1', name: 'preview-pr-10-db1' },
      ]),
    );

    mockGetPullRequest.mockResolvedValue({ data: { state: 'open' } });

    await cleanupOrphanedDatabases(client, ACCOUNT_ID, 'fake-token', REPO);

    expect(mockDelete).not.toHaveBeenCalled();
  });

  test('continues cleanup if one PR lookup fails', async () => {
    const client = makeMockClient();
    (client.d1.database.list as ReturnType<typeof vi.fn>).mockReturnValue(
      asyncIterable([
        { uuid: 'uuid-1', name: 'preview-pr-5-db1' },
        { uuid: 'uuid-2', name: 'preview-pr-8-db1' },
      ]),
    );

    mockGetPullRequest
      .mockRejectedValueOnce(new Error('API error'))       // PR 5 lookup fails
      .mockResolvedValueOnce({ data: { state: 'closed' } }); // PR 8 is closed

    mockDelete.mockResolvedValue(undefined);

    await cleanupOrphanedDatabases(client, ACCOUNT_ID, 'fake-token', REPO);

    // Should still delete databases for PR 8 despite PR 5 lookup failing
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledWith(client, ACCOUNT_ID, 'uuid-2');
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('PR #5'));
  });

  test('logs summary of cleaned-up PRs', async () => {
    const client = makeMockClient();
    (client.d1.database.list as ReturnType<typeof vi.fn>).mockReturnValue(
      asyncIterable([
        { uuid: 'uuid-1', name: 'preview-pr-3-db1' },
        { uuid: 'uuid-2', name: 'preview-pr-3-db2' },
      ]),
    );

    mockGetPullRequest.mockResolvedValue({ data: { state: 'closed' } });
    mockDelete.mockResolvedValue(undefined);

    await cleanupOrphanedDatabases(client, ACCOUNT_ID, 'fake-token', REPO);

    expect(core.info).toHaveBeenCalled();
  });
});

describe('cleanupOrphanedDatabases — KV namespaces', () => {
  test('cleans up orphaned KV namespaces for closed PRs', async () => {
    const client = makeMockClient([
      { id: 'kv-1', title: 'preview-pr-5-MY_KV' },
      { id: 'kv-2', title: 'preview-pr-5-CACHE' },
    ]);
    (client.d1.database.list as ReturnType<typeof vi.fn>).mockReturnValue(
      asyncIterable([]),
    );

    mockGetPullRequest.mockResolvedValue({ data: { state: 'closed' } });
    mockKVDelete.mockResolvedValue(undefined);

    await cleanupOrphanedDatabases(client, ACCOUNT_ID, 'fake-token', REPO);

    expect(mockKVDelete).toHaveBeenCalledTimes(2);
    expect(mockKVDelete).toHaveBeenCalledWith(client, ACCOUNT_ID, 'kv-1');
    expect(mockKVDelete).toHaveBeenCalledWith(client, ACCOUNT_ID, 'kv-2');
  });

  test('handles mix of D1 and KV resources for same PR', async () => {
    const client = makeMockClient([
      { id: 'kv-1', title: 'preview-pr-7-MY_KV' },
    ]);
    (client.d1.database.list as ReturnType<typeof vi.fn>).mockReturnValue(
      asyncIterable([
        { uuid: 'uuid-1', name: 'preview-pr-7-mydb' },
      ]),
    );

    mockGetPullRequest.mockResolvedValue({ data: { state: 'closed' } });
    mockDelete.mockResolvedValue(undefined);
    mockKVDelete.mockResolvedValue(undefined);

    await cleanupOrphanedDatabases(client, ACCOUNT_ID, 'fake-token', REPO);

    // Should check PR only once despite having both D1 and KV resources
    expect(mockGetPullRequest).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockKVDelete).toHaveBeenCalledTimes(1);
  });

  test('leaves KV namespaces for open PRs untouched', async () => {
    const client = makeMockClient([
      { id: 'kv-1', title: 'preview-pr-10-MY_KV' },
    ]);
    (client.d1.database.list as ReturnType<typeof vi.fn>).mockReturnValue(
      asyncIterable([]),
    );

    mockGetPullRequest.mockResolvedValue({ data: { state: 'open' } });

    await cleanupOrphanedDatabases(client, ACCOUNT_ID, 'fake-token', REPO);

    expect(mockKVDelete).not.toHaveBeenCalled();
  });
});

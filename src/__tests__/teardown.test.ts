import { test, expect, describe, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import * as core from '@actions/core';
import { teardownDatabases, teardownKVNamespaces } from '../teardown.js';
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

const mockList = vi.mocked(d1.listPreviewDatabases);
const mockDelete = vi.mocked(d1.deleteDatabase);
const mockKVList = vi.mocked(kv.listPreviewKVNamespaces);
const mockKVDelete = vi.mocked(kv.deleteKVNamespace);

const ACCOUNT_ID = 'test-account-123';

function makeMockClient() {
  return {} as unknown as import('cloudflare').default;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('teardownDatabases', () => {
  test('lists and deletes all databases matching PR prefix', async () => {
    const client = makeMockClient();
    mockList.mockResolvedValue([
      { uuid: 'uuid-1', name: 'preview-pr-42-mydb' },
      { uuid: 'uuid-2', name: 'preview-pr-42-analytics' },
    ]);
    mockDelete.mockResolvedValue(undefined);

    const result = await teardownDatabases(client, ACCOUNT_ID, 42);

    expect(mockList).toHaveBeenCalledWith(client, ACCOUNT_ID, 42);
    expect(mockDelete).toHaveBeenCalledTimes(2);
    expect(mockDelete).toHaveBeenCalledWith(client, ACCOUNT_ID, 'uuid-1');
    expect(mockDelete).toHaveBeenCalledWith(client, ACCOUNT_ID, 'uuid-2');
    expect(result).toEqual(['preview-pr-42-mydb', 'preview-pr-42-analytics']);
  });

  test('handles no databases to delete (clean state)', async () => {
    const client = makeMockClient();
    mockList.mockResolvedValue([]);

    const result = await teardownDatabases(client, ACCOUNT_ID, 42);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('continues deleting remaining databases if one delete fails', async () => {
    const client = makeMockClient();
    mockList.mockResolvedValue([
      { uuid: 'uuid-1', name: 'preview-pr-42-db1' },
      { uuid: 'uuid-2', name: 'preview-pr-42-db2' },
      { uuid: 'uuid-3', name: 'preview-pr-42-db3' },
    ]);
    mockDelete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('server error'))
      .mockResolvedValueOnce(undefined);

    const result = await teardownDatabases(client, ACCOUNT_ID, 42);

    expect(mockDelete).toHaveBeenCalledTimes(3);
    expect(result).toEqual(['preview-pr-42-db1', 'preview-pr-42-db3']);
  });

  test('logs warnings for failed deletes, does not throw', async () => {
    const client = makeMockClient();
    mockList.mockResolvedValue([
      { uuid: 'uuid-1', name: 'preview-pr-42-db1' },
    ]);
    mockDelete.mockRejectedValue(new Error('delete failed'));

    const result = await teardownDatabases(client, ACCOUNT_ID, 42);

    expect(core.warning).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('returns list of deleted database names', async () => {
    const client = makeMockClient();
    mockList.mockResolvedValue([
      { uuid: 'uuid-1', name: 'preview-pr-10-users' },
      { uuid: 'uuid-2', name: 'preview-pr-10-posts' },
    ]);
    mockDelete.mockResolvedValue(undefined);

    const result = await teardownDatabases(client, ACCOUNT_ID, 10);

    expect(result).toEqual(['preview-pr-10-users', 'preview-pr-10-posts']);
  });
});

describe('teardownKVNamespaces', () => {
  test('lists and deletes all KV namespaces matching PR prefix', async () => {
    const client = makeMockClient();
    mockKVList.mockResolvedValue([
      { id: 'ns-1', title: 'preview-pr-42-MY_KV' },
      { id: 'ns-2', title: 'preview-pr-42-CACHE' },
    ]);
    mockKVDelete.mockResolvedValue(undefined);

    const result = await teardownKVNamespaces(client, ACCOUNT_ID, 42);

    expect(mockKVList).toHaveBeenCalledWith(client, ACCOUNT_ID, 42);
    expect(mockKVDelete).toHaveBeenCalledTimes(2);
    expect(mockKVDelete).toHaveBeenCalledWith(client, ACCOUNT_ID, 'ns-1');
    expect(mockKVDelete).toHaveBeenCalledWith(client, ACCOUNT_ID, 'ns-2');
    expect(result).toEqual(['preview-pr-42-MY_KV', 'preview-pr-42-CACHE']);
  });

  test('handles no namespaces to delete (clean state)', async () => {
    const client = makeMockClient();
    mockKVList.mockResolvedValue([]);

    const result = await teardownKVNamespaces(client, ACCOUNT_ID, 42);

    expect(mockKVDelete).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  test('continues deleting remaining namespaces if one delete fails', async () => {
    const client = makeMockClient();
    mockKVList.mockResolvedValue([
      { id: 'ns-1', title: 'preview-pr-42-kv1' },
      { id: 'ns-2', title: 'preview-pr-42-kv2' },
      { id: 'ns-3', title: 'preview-pr-42-kv3' },
    ]);
    mockKVDelete
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('server error'))
      .mockResolvedValueOnce(undefined);

    const result = await teardownKVNamespaces(client, ACCOUNT_ID, 42);

    expect(mockKVDelete).toHaveBeenCalledTimes(3);
    expect(result).toEqual(['preview-pr-42-kv1', 'preview-pr-42-kv3']);
  });

  test('returns list of deleted namespace titles', async () => {
    const client = makeMockClient();
    mockKVList.mockResolvedValue([
      { id: 'ns-1', title: 'preview-pr-10-CACHE' },
      { id: 'ns-2', title: 'preview-pr-10-SESSIONS' },
    ]);
    mockKVDelete.mockResolvedValue(undefined);

    const result = await teardownKVNamespaces(client, ACCOUNT_ID, 10);

    expect(result).toEqual(['preview-pr-10-CACHE', 'preview-pr-10-SESSIONS']);
  });
});

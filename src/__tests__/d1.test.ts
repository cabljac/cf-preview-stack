import { test, expect, describe, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import { createDatabase, deleteDatabase, listPreviewDatabases } from '../d1.js';

function makeMockClient(overrides: {
  create?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    d1: {
      database: {
        create: overrides.create ?? vi.fn(),
        delete: overrides.delete ?? vi.fn(),
        list: overrides.list ?? vi.fn(),
      },
    },
  } as unknown as import('cloudflare').default;
}

/** Helper to make an async iterable from an array (simulates paginated list). */
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

const ACCOUNT_ID = 'test-account-123';

describe('createDatabase', () => {
  test('calls SDK with correct name and account_id, returns uuid', async () => {
    const create = vi.fn().mockResolvedValue({
      uuid: 'new-db-uuid',
      name: 'preview-pr-42-mydb',
    });
    const client = makeMockClient({ create });

    const result = await createDatabase(client, ACCOUNT_ID, 'preview-pr-42-mydb');
    expect(create).toHaveBeenCalledWith({
      account_id: ACCOUNT_ID,
      name: 'preview-pr-42-mydb',
    });
    expect(result).toBe('new-db-uuid');
  });
});

describe('deleteDatabase', () => {
  test('calls SDK with correct uuid and account_id', async () => {
    const del = vi.fn().mockResolvedValue(null);
    const client = makeMockClient({ delete: del });

    await deleteDatabase(client, ACCOUNT_ID, 'db-uuid-to-delete');
    expect(del).toHaveBeenCalledWith('db-uuid-to-delete', {
      account_id: ACCOUNT_ID,
    });
  });

  test('swallows 404 errors (already deleted), logs warning', async () => {
    const error = new Error('not found');
    (error as unknown as Record<string, number>).status = 404;
    const del = vi.fn().mockRejectedValue(error);
    const client = makeMockClient({ delete: del });

    // Should not throw
    await expect(deleteDatabase(client, ACCOUNT_ID, 'missing-uuid')).resolves.toBeUndefined();
  });

  test('rethrows non-404 errors', async () => {
    const error = new Error('server error');
    (error as unknown as Record<string, number>).status = 500;
    const del = vi.fn().mockRejectedValue(error);
    const client = makeMockClient({ delete: del });

    await expect(deleteDatabase(client, ACCOUNT_ID, 'some-uuid')).rejects.toThrow('server error');
  });
});

describe('listPreviewDatabases', () => {
  test('filters by preview-pr-{N}- prefix', async () => {
    const databases = [
      { uuid: 'uuid-1', name: 'preview-pr-42-mydb' },
      { uuid: 'uuid-2', name: 'preview-pr-42-analytics' },
      { uuid: 'uuid-3', name: 'production-db' },
      { uuid: 'uuid-4', name: 'preview-pr-99-other' },
    ];
    const list = vi.fn().mockReturnValue(asyncIterable(databases));
    const client = makeMockClient({ list });

    const result = await listPreviewDatabases(client, ACCOUNT_ID, 42);
    expect(result).toEqual([
      { uuid: 'uuid-1', name: 'preview-pr-42-mydb' },
      { uuid: 'uuid-2', name: 'preview-pr-42-analytics' },
    ]);
  });

  test('paginates through all results', async () => {
    // The async iterable handles pagination transparently
    const databases = Array.from({ length: 50 }, (_, i) => ({
      uuid: `uuid-${i}`,
      name: i < 25 ? `preview-pr-10-db${i}` : `other-db-${i}`,
    }));
    const list = vi.fn().mockReturnValue(asyncIterable(databases));
    const client = makeMockClient({ list });

    const result = await listPreviewDatabases(client, ACCOUNT_ID, 10);
    expect(result).toHaveLength(25);
    expect(list).toHaveBeenCalledWith({ account_id: ACCOUNT_ID });
  });
});

describe('retry on rate limit', () => {
  test('retries on 429 with exponential backoff, max 3 retries', async () => {
    const rateLimitError = new Error('rate limited');
    (rateLimitError as unknown as Record<string, number>).status = 429;

    const create = vi
      .fn()
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockResolvedValue({ uuid: 'success-uuid', name: 'preview-pr-1-db' });

    const client = makeMockClient({ create });

    const result = await createDatabase(client, ACCOUNT_ID, 'preview-pr-1-db', 1);
    expect(result).toBe('success-uuid');
    expect(create).toHaveBeenCalledTimes(3);
  });

  test('fails after max retries exhausted', async () => {
    const makeError = () => {
      const e = new Error('rate limited');
      (e as unknown as Record<string, number>).status = 429;
      return e;
    };

    const create = vi.fn()
      .mockRejectedValueOnce(makeError())
      .mockRejectedValueOnce(makeError())
      .mockRejectedValueOnce(makeError())
      .mockRejectedValueOnce(makeError());
    const client = makeMockClient({ create });

    await expect(
      createDatabase(client, ACCOUNT_ID, 'preview-pr-1-db', 1),
    ).rejects.toThrow('rate limited');
    expect(create).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });
});

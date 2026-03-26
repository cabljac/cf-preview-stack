import { test, expect, describe, vi } from 'vitest';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import { createKVNamespace, deleteKVNamespace, listPreviewKVNamespaces } from '../kv.js';

function makeMockClient(overrides: {
  create?: ReturnType<typeof vi.fn>;
  delete?: ReturnType<typeof vi.fn>;
  list?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    kv: {
      namespaces: {
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

describe('createKVNamespace', () => {
  test('calls SDK with correct title and account_id, returns id', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'new-ns-id',
      title: 'preview-pr-42-MY_KV',
    });
    const client = makeMockClient({ create });

    const result = await createKVNamespace(client, ACCOUNT_ID, 'preview-pr-42-MY_KV');
    expect(create).toHaveBeenCalledWith({
      account_id: ACCOUNT_ID,
      title: 'preview-pr-42-MY_KV',
    });
    expect(result).toBe('new-ns-id');
  });
});

describe('deleteKVNamespace', () => {
  test('calls SDK with correct namespace id and account_id', async () => {
    const del = vi.fn().mockResolvedValue(null);
    const client = makeMockClient({ delete: del });

    await deleteKVNamespace(client, ACCOUNT_ID, 'ns-id-to-delete');
    expect(del).toHaveBeenCalledWith('ns-id-to-delete', {
      account_id: ACCOUNT_ID,
    });
  });

  test('swallows 404 errors (already deleted), logs warning', async () => {
    const error = new Error('not found');
    (error as unknown as Record<string, number>).status = 404;
    const del = vi.fn().mockRejectedValue(error);
    const client = makeMockClient({ delete: del });

    await expect(deleteKVNamespace(client, ACCOUNT_ID, 'missing-ns-id')).resolves.toBeUndefined();
  });

  test('rethrows non-404 errors', async () => {
    const error = new Error('server error');
    (error as unknown as Record<string, number>).status = 500;
    const del = vi.fn().mockRejectedValue(error);
    const client = makeMockClient({ delete: del });

    await expect(deleteKVNamespace(client, ACCOUNT_ID, 'some-ns-id')).rejects.toThrow('server error');
  });
});

describe('listPreviewKVNamespaces', () => {
  test('filters by preview-pr-{N}- prefix on title', async () => {
    const namespaces = [
      { id: 'ns-1', title: 'preview-pr-42-MY_KV' },
      { id: 'ns-2', title: 'preview-pr-42-CACHE' },
      { id: 'ns-3', title: 'production-kv' },
      { id: 'ns-4', title: 'preview-pr-99-OTHER' },
    ];
    const list = vi.fn().mockReturnValue(asyncIterable(namespaces));
    const client = makeMockClient({ list });

    const result = await listPreviewKVNamespaces(client, ACCOUNT_ID, 42);
    expect(result).toEqual([
      { id: 'ns-1', title: 'preview-pr-42-MY_KV' },
      { id: 'ns-2', title: 'preview-pr-42-CACHE' },
    ]);
  });

  test('paginates through all results', async () => {
    const namespaces = Array.from({ length: 50 }, (_, i) => ({
      id: `ns-${i}`,
      title: i < 25 ? `preview-pr-10-kv${i}` : `other-kv-${i}`,
    }));
    const list = vi.fn().mockReturnValue(asyncIterable(namespaces));
    const client = makeMockClient({ list });

    const result = await listPreviewKVNamespaces(client, ACCOUNT_ID, 10);
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
      .mockResolvedValue({ id: 'success-ns-id', title: 'preview-pr-1-kv' });

    const client = makeMockClient({ create });

    const result = await createKVNamespace(client, ACCOUNT_ID, 'preview-pr-1-kv', 1);
    expect(result).toBe('success-ns-id');
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
      createKVNamespace(client, ACCOUNT_ID, 'preview-pr-1-kv', 1),
    ).rejects.toThrow('rate limited');
    expect(create).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });
});

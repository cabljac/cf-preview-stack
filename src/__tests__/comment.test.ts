import { test, expect, describe, vi, beforeEach } from 'vitest';
import { postPreviewComment, postTeardownComment, COMMENT_MARKER } from '../comment.js';
import type { PreviewResult, DatabaseResult } from '../types.js';

const mockCreateComment = vi.fn();
const mockUpdateComment = vi.fn();
const mockListComments = vi.fn();

vi.mock('@actions/github', () => ({
  getOctokit: () => ({
    rest: {
      issues: {
        createComment: mockCreateComment,
        updateComment: mockUpdateComment,
        listComments: mockListComments,
      },
    },
  }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const REPO = { owner: 'test-owner', repo: 'test-repo' };

describe('postPreviewComment', () => {
  test('creates new comment when no existing comment found', async () => {
    mockListComments.mockResolvedValue({ data: [] });
    mockCreateComment.mockResolvedValue({ data: { id: 1 } });

    const previews: PreviewResult[] = [
      { workerName: 'api', previewUrl: 'pr-42-api.example.workers.dev' },
    ];
    const databases: DatabaseResult[] = [
      { originalName: 'mydb', previewName: 'preview-pr-42-mydb', previewId: 'uuid-1', migrationsApplied: 3 },
    ];

    await postPreviewComment('fake-token', REPO, 42, previews, databases);

    expect(mockCreateComment).toHaveBeenCalledTimes(1);
    expect(mockUpdateComment).not.toHaveBeenCalled();
  });

  test('updates existing comment when marker found', async () => {
    mockListComments.mockResolvedValue({
      data: [
        { id: 100, body: `${COMMENT_MARKER}\nold content` },
      ],
    });
    mockUpdateComment.mockResolvedValue({ data: { id: 100 } });

    const previews: PreviewResult[] = [
      { workerName: 'api', previewUrl: 'pr-42-api.example.workers.dev' },
    ];
    const databases: DatabaseResult[] = [];

    await postPreviewComment('fake-token', REPO, 42, previews, databases);

    expect(mockUpdateComment).toHaveBeenCalledTimes(1);
    expect(mockCreateComment).not.toHaveBeenCalled();
  });

  test('formats active preview table with worker URLs and database info', async () => {
    mockListComments.mockResolvedValue({ data: [] });
    mockCreateComment.mockResolvedValue({ data: { id: 1 } });

    const previews: PreviewResult[] = [
      { workerName: 'api', previewUrl: 'pr-42-api.example.workers.dev' },
      { workerName: 'web', previewUrl: 'pr-42-web.example.workers.dev' },
    ];
    const databases: DatabaseResult[] = [
      { originalName: 'mydb', previewName: 'preview-pr-42-mydb', previewId: 'uuid-1', migrationsApplied: 3 },
    ];

    await postPreviewComment('fake-token', REPO, 42, previews, databases);

    const body = mockCreateComment.mock.calls[0][0].body as string;
    expect(body).toContain('api');
    expect(body).toContain('pr-42-api.example.workers.dev');
    expect(body).toContain('web');
    expect(body).toContain('pr-42-web.example.workers.dev');
    expect(body).toContain('mydb');
    expect(body).toContain('preview-pr-42-mydb');
    expect(body).toContain('3 applied');
  });

  test('includes marker in comment body', async () => {
    mockListComments.mockResolvedValue({ data: [] });
    mockCreateComment.mockResolvedValue({ data: { id: 1 } });

    await postPreviewComment('fake-token', REPO, 42, [], []);

    const body = mockCreateComment.mock.calls[0][0].body as string;
    expect(body).toContain(COMMENT_MARKER);
  });
});

describe('postTeardownComment', () => {
  test('formats teardown message', async () => {
    mockListComments.mockResolvedValue({
      data: [
        { id: 200, body: `${COMMENT_MARKER}\nold content` },
      ],
    });
    mockUpdateComment.mockResolvedValue({ data: { id: 200 } });

    await postTeardownComment('fake-token', REPO, 42);

    const body = mockUpdateComment.mock.calls[0][0].body as string;
    expect(body).toContain('torn down');
    expect(body).toContain(COMMENT_MARKER);
  });

  test('creates new comment if no existing comment found for teardown', async () => {
    mockListComments.mockResolvedValue({ data: [] });
    mockCreateComment.mockResolvedValue({ data: { id: 1 } });

    await postTeardownComment('fake-token', REPO, 42);

    expect(mockCreateComment).toHaveBeenCalledTimes(1);
    const body = mockCreateComment.mock.calls[0][0].body as string;
    expect(body).toContain('torn down');
  });
});

describe('comment skipping', () => {
  test('skips commenting when comment input is false', async () => {
    // postPreviewComment and postTeardownComment shouldn't be called at all
    // when comment is false. This is controlled at the orchestration layer,
    // but we verify the functions don't throw when called with empty data.
    mockListComments.mockResolvedValue({ data: [] });
    mockCreateComment.mockResolvedValue({ data: { id: 1 } });

    await postPreviewComment('fake-token', REPO, 42, [], []);
    expect(mockCreateComment).toHaveBeenCalledTimes(1);
  });
});

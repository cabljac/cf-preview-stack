import { test, expect, describe, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import { runMigrations, runCustomMigration, uploadPreviewVersion } from '../preview.js';
import type { D1Binding } from '../types.js';

const mockExec = vi.fn();

vi.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => mockExec(...args),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const ENV_VARS = {
  apiToken: 'test-token',
  accountId: 'test-account',
};

describe('runMigrations', () => {
  test('runs migrations for each D1 binding with a migrations_dir', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: 'Migrations applied successfully', stderr: '' });
    });

    const bindings: D1Binding[] = [
      { binding: 'DB', database_name: 'preview-pr-42-mydb', database_id: 'uuid-1', migrations_dir: './migrations' },
      { binding: 'CACHE', database_name: 'preview-pr-42-cache', database_id: 'uuid-2', migrations_dir: './migrations/cache' },
    ];

    const count = await runMigrations(bindings, '/work/api', ENV_VARS);

    expect(mockExec).toHaveBeenCalledTimes(2);
    expect(count).toBe(2);
  });

  test('skips migrations for bindings without migrations_dir', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: 'OK', stderr: '' });
    });

    const bindings: D1Binding[] = [
      { binding: 'DB', database_name: 'preview-pr-42-mydb', database_id: 'uuid-1', migrations_dir: './migrations' },
      { binding: 'ANALYTICS', database_name: 'preview-pr-42-analytics', database_id: 'uuid-2' },
    ];

    const count = await runMigrations(bindings, '/work/api', ENV_VARS);

    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(count).toBe(1);
  });

  test('passes CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID as env vars', async () => {
    mockExec.mockImplementation((_cmd: string, opts: Record<string, unknown>, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: 'OK', stderr: '' });
    });

    const bindings: D1Binding[] = [
      { binding: 'DB', database_name: 'preview-pr-42-mydb', database_id: 'uuid-1', migrations_dir: './migrations' },
    ];

    await runMigrations(bindings, '/work/api', ENV_VARS);

    const opts = mockExec.mock.calls[0][1] as Record<string, Record<string, string>>;
    expect(opts.env.CLOUDFLARE_API_TOKEN).toBe('test-token');
    expect(opts.env.CLOUDFLARE_ACCOUNT_ID).toBe('test-account');
  });

  test('throws on non-zero exit code with stderr in error message', async () => {
    const execError = new Error('Command failed') as Error & { stderr: string };
    execError.stderr = 'Migration error: table already exists';
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error) => void) => {
      cb(execError);
    });

    const bindings: D1Binding[] = [
      { binding: 'DB', database_name: 'preview-pr-42-mydb', database_id: 'uuid-1', migrations_dir: './migrations' },
    ];

    await expect(runMigrations(bindings, '/work/api', ENV_VARS)).rejects.toThrow();
  });
});

describe('runCustomMigration', () => {
  test('runs the provided command in the working directory', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: 'Migrations pushed', stderr: '' });
    });

    await runCustomMigration('npx drizzle-kit push', '/work/api', ENV_VARS);

    expect(mockExec).toHaveBeenCalledTimes(1);
    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toBe('npx drizzle-kit push');

    const opts = mockExec.mock.calls[0][1] as Record<string, unknown>;
    expect(opts.cwd).toBe('/work/api');
  });

  test('passes CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID as env vars', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: 'OK', stderr: '' });
    });

    await runCustomMigration('npx drizzle-kit push', '/work/api', ENV_VARS);

    const opts = mockExec.mock.calls[0][1] as Record<string, Record<string, string>>;
    expect(opts.env.CLOUDFLARE_API_TOKEN).toBe('test-token');
    expect(opts.env.CLOUDFLARE_ACCOUNT_ID).toBe('test-account');
  });

  test('throws on non-zero exit code', async () => {
    const execError = new Error('Command failed');
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error) => void) => {
      cb(execError);
    });

    await expect(runCustomMigration('npx drizzle-kit push', '/work/api', ENV_VARS)).rejects.toThrow();
  });
});

describe('uploadPreviewVersion', () => {
  test('runs wrangler versions upload --preview-alias pr-{N} with correct cwd', async () => {
    mockExec.mockImplementation((cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, 'Version uploaded\nPreview alias: pr-42-api.example.workers.dev', '');
    });

    await uploadPreviewVersion('api', '/work/api', 42, ENV_VARS);

    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain('wrangler versions upload');
    expect(cmd).toContain('--preview-alias pr-42');

    const opts = mockExec.mock.calls[0][1] as Record<string, string>;
    expect(opts.cwd).toBe('/work/api');
  });

  test('parses preview URL from wrangler stdout', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, 'Worker Version ID: abc-123\nPreview: https://pr-42-api.example.workers.dev', '');
    });

    const result = await uploadPreviewVersion('api', '/work/api', 42, ENV_VARS);

    expect(result.workerName).toBe('api');
    expect(result.previewUrl).toContain('pr-42-api.example.workers.dev');
  });

  test('passes CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID as env vars', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, 'Preview: https://pr-1-web.example.workers.dev', '');
    });

    await uploadPreviewVersion('web', '/work/web', 1, ENV_VARS);

    const opts = mockExec.mock.calls[0][1] as Record<string, Record<string, string>>;
    expect(opts.env.CLOUDFLARE_API_TOKEN).toBe('test-token');
    expect(opts.env.CLOUDFLARE_ACCOUNT_ID).toBe('test-account');
  });

  test('throws on non-zero exit code with stderr in error message', async () => {
    const execError = new Error('Command failed') as Error & { stderr: string };
    execError.stderr = 'Error: Worker not found';
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error) => void) => {
      cb(execError);
    });

    await expect(uploadPreviewVersion('api', '/work/api', 42, ENV_VARS)).rejects.toThrow();
  });

  test('returns PreviewResult with worker name and URL', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, 'https://pr-5-myworker.subdomain.workers.dev', '');
    });

    const result = await uploadPreviewVersion('myworker', '/work', 5, ENV_VARS);

    expect(result).toEqual({
      workerName: 'myworker',
      previewUrl: 'pr-5-myworker.subdomain.workers.dev',
    });
  });
});

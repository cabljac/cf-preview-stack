import { test, expect, describe, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import { runMigrations, uploadPreviewVersion } from '../preview.js';
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

  test('passes -c flag with configPath when provided', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, result: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: 'OK', stderr: '' });
    });

    const bindings: D1Binding[] = [
      { binding: 'DB', database_name: 'preview-pr-42-mydb', database_id: 'uuid-1', migrations_dir: './migrations' },
    ];

    await runMigrations(bindings, '/work/api', ENV_VARS, '/work/api/dist/wrangler.json');

    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain('-c /work/api/dist/wrangler.json');
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
    const execError = new Error('Command failed');
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
      cb(execError, '', 'Migration error: table already exists');
    });

    const bindings: D1Binding[] = [
      { binding: 'DB', database_name: 'preview-pr-42-mydb', database_id: 'uuid-1', migrations_dir: './migrations' },
    ];

    await expect(runMigrations(bindings, '/work/api', ENV_VARS)).rejects.toThrow('Migration error: table already exists');
  });
});

describe('uploadPreviewVersion', () => {
  test('runs wrangler deploy with correct cwd', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, 'Deployed api-pr-42.example.workers.dev', '');
    });

    await uploadPreviewVersion('api', '/work/api', 42, ENV_VARS);

    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain('wrangler deploy');
    expect(cmd).not.toContain('versions upload');

    const opts = mockExec.mock.calls[0][1] as Record<string, string>;
    expect(opts.cwd).toBe('/work/api');
  });

  test('passes -c flag with configPath when provided', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, 'Deployed api-pr-42.example.workers.dev', '');
    });

    await uploadPreviewVersion('api', '/work/api', 42, ENV_VARS, '/work/api/dist/out/wrangler.json');

    const cmd = mockExec.mock.calls[0][0] as string;
    expect(cmd).toContain('-c /work/api/dist/out/wrangler.json');
  });

  test('parses workers.dev URL from deploy output', async () => {
    const stdout = [
      '⛅️ wrangler 4.70.0',
      '─────────────────────────────────────────────',
      'Total Upload: 7426.37 KiB / gzip: 1215.35 KiB',
      'Uploaded memcard-pr-42 (6.35 sec)',
      'Deployed https://memcard-pr-42.jacobcable94.workers.dev',
    ].join('\n');
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, stdout, '');
    });

    const result = await uploadPreviewVersion('memcard', '/work/web', 42, ENV_VARS);

    expect(result.workerName).toBe('memcard');
    expect(result.previewUrl).toBe('memcard-pr-42.jacobcable94.workers.dev');
  });

  test('passes CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID as env vars', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, 'Deployed https://web-pr-1.example.workers.dev', '');
    });

    await uploadPreviewVersion('web', '/work/web', 1, ENV_VARS);

    const opts = mockExec.mock.calls[0][1] as Record<string, Record<string, string>>;
    expect(opts.env.CLOUDFLARE_API_TOKEN).toBe('test-token');
    expect(opts.env.CLOUDFLARE_ACCOUNT_ID).toBe('test-account');
  });

  test('throws on non-zero exit code', async () => {
    const execError = new Error('Command failed') as Error & { stderr: string };
    execError.stderr = 'Error: Worker not found';
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: Error, stdout: string, stderr: string) => void) => {
      cb(execError, '', 'Error: Worker not found');
    });

    await expect(uploadPreviewVersion('api', '/work/api', 42, ENV_VARS)).rejects.toThrow('Error: Worker not found');
  });

  test('parses workers.dev URL from stderr when stdout is empty', async () => {
    const stderr = [
      '⛅️ wrangler 4.70.0',
      'Total Upload: 7426.37 KiB / gzip: 1215.35 KiB',
      'Uploaded memcard-pr-42 (6.35 sec)',
      'Deployed https://memcard-pr-42.jacobcable94.workers.dev',
    ].join('\n');
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, '', stderr);
    });

    const result = await uploadPreviewVersion('memcard', '/work/web', 42, ENV_VARS);

    expect(result.workerName).toBe('memcard');
    expect(result.previewUrl).toBe('memcard-pr-42.jacobcable94.workers.dev');
  });

  test('returns fallback URL when wrangler prints no workers.dev URL', async () => {
    mockExec.mockImplementation((_cmd: string, _opts: unknown, cb: (err: null, stdout: string, stderr: string) => void) => {
      cb(null, 'Uploaded myworker-pr-5 (1.5 sec)', '');
    });

    const result = await uploadPreviewVersion('myworker', '/work', 5, ENV_VARS);

    expect(result).toEqual({
      workerName: 'myworker',
      previewUrl: 'myworker-pr-5.workers.dev',
    });
  });
});

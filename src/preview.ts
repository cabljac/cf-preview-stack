import { exec } from 'node:child_process';
import * as core from '@actions/core';
import type { D1Binding, PreviewResult } from './types.js';

interface CloudflareEnv {
  apiToken: string;
  accountId: string;
}

function execAsync(
  command: string,
  options: { cwd: string; env: Record<string, string | undefined> },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout as string, stderr: stderr as string });
    });
  });
}

function makeEnv(cfEnv: CloudflareEnv): Record<string, string | undefined> {
  return {
    ...process.env,
    CLOUDFLARE_API_TOKEN: cfEnv.apiToken,
    CLOUDFLARE_ACCOUNT_ID: cfEnv.accountId,
  };
}

/**
 * Run D1 migrations for all bindings that have a migrations_dir.
 * Returns the number of migration commands executed.
 */
export async function runMigrations(
  bindings: D1Binding[],
  workingDirectory: string,
  cfEnv: CloudflareEnv,
): Promise<number> {
  const env = makeEnv(cfEnv);
  let count = 0;

  for (const binding of bindings) {
    if (!binding.migrations_dir) {
      continue;
    }

    const cmd = `npx wrangler d1 migrations apply ${binding.database_name} --remote`;
    core.info(`Running migrations: ${cmd} (cwd: ${workingDirectory})`);

    await execAsync(cmd, { cwd: workingDirectory, env });
    count++;
  }

  return count;
}

/**
 * Run a custom migration command (e.g. "npx drizzle-kit push") instead of
 * wrangler's built-in D1 migrations. The command runs in the worker's working
 * directory with Cloudflare credentials in the environment.
 */
export async function runCustomMigration(
  command: string,
  workingDirectory: string,
  cfEnv: CloudflareEnv,
): Promise<void> {
  const env = makeEnv(cfEnv);
  core.info(`Running custom migration: ${command} (cwd: ${workingDirectory})`);
  await execAsync(command, { cwd: workingDirectory, env });
}

/**
 * Parse a preview URL from wrangler's stdout output.
 * Looks for URLs matching the *.workers.dev pattern.
 */
function parsePreviewUrl(stdout: string): string | null {
  const match = stdout.match(/(https?:\/\/)?([\w.-]+\.workers\.dev)/);
  return match ? match[2] : null;
}

/**
 * Upload a preview version of a worker using wrangler versions upload.
 * Returns the worker name and preview URL.
 */
export async function uploadPreviewVersion(
  workerName: string,
  workingDirectory: string,
  prNumber: number,
  cfEnv: CloudflareEnv,
): Promise<PreviewResult> {
  const alias = `pr-${prNumber}`;
  const cmd = `npx wrangler versions upload --preview-alias ${alias}`;
  core.info(`Uploading preview version: ${cmd} (cwd: ${workingDirectory})`);

  const env = makeEnv(cfEnv);
  const { stdout } = await execAsync(cmd, { cwd: workingDirectory, env });

  const previewUrl = parsePreviewUrl(stdout) ?? `${alias}-${workerName}.workers.dev`;

  return {
    workerName,
    previewUrl,
  };
}

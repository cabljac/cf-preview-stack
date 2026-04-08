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
        const msg = stderr?.trim() ? `${error.message}\n${stderr.trim()}` : error.message;
        reject(new Error(msg));
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
  configPath?: string,
): Promise<number> {
  const env = makeEnv(cfEnv);
  let count = 0;
  const configFlag = configPath ? ` -c ${configPath}` : '';

  for (const binding of bindings) {
    if (!binding.migrations_dir) {
      continue;
    }

    const cmd = `npx wrangler d1 migrations apply ${binding.database_name} --remote${configFlag}`;
    core.info(`Running migrations: ${cmd} (cwd: ${workingDirectory})`);

    await execAsync(cmd, { cwd: workingDirectory, env });
    count++;
  }

  return count;
}

/**
 * Parse a workers.dev URL from wrangler deploy stdout.
 */
function parseDeployUrl(stdout: string): string | null {
  const match = stdout.match(/https?:\/\/([\w.-]+\.workers\.dev)/);
  return match ? match[1] : null;
}

/**
 * Deploy an isolated PR worker using wrangler deploy.
 * The config must already have the PR worker name written in (via rewriteWorkerName).
 * Returns the worker name and its workers.dev URL.
 */
export async function uploadPreviewVersion(
  workerName: string,
  workingDirectory: string,
  prNumber: number,
  cfEnv: CloudflareEnv,
  configPath?: string,
): Promise<PreviewResult> {
  const configFlag = configPath ? ` -c ${configPath}` : '';
  const cmd = `npx wrangler deploy${configFlag}`;
  core.info(`Deploying PR worker: ${cmd} (cwd: ${workingDirectory})`);

  const env = makeEnv(cfEnv);
  const { stdout, stderr } = await execAsync(cmd, { cwd: workingDirectory, env });

  core.info(`wrangler output: ${stdout || stderr}`);
  const parsedUrl = parseDeployUrl(stdout) ?? parseDeployUrl(stderr);
  const prWorkerName = `${workerName}-pr-${prNumber}`;
  const previewUrl = parsedUrl ?? `${prWorkerName}.workers.dev`;
  core.info(`Preview URL for ${workerName}: ${previewUrl}${parsedUrl ? '' : ' (fallback)'}`);

  return { workerName, previewUrl };
}

/**
 * Delete a deployed PR worker by name.
 */
export async function deleteWorker(
  workerName: string,
  workingDirectory: string,
  cfEnv: CloudflareEnv,
): Promise<void> {
  const cmd = `npx wrangler delete --name ${workerName} --force`;
  core.info(`Deleting PR worker: ${cmd} (cwd: ${workingDirectory})`);
  const env = makeEnv(cfEnv);
  try {
    await execAsync(cmd, { cwd: workingDirectory, env });
  } catch (error) {
    core.warning(`Failed to delete worker ${workerName}: ${error}`);
  }
}

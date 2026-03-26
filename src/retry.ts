import * as core from '@actions/core';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

export function isRateLimited(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<string, unknown>).status === 429;
}

export function is404(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as Record<string, unknown>).status === 404;
}

/**
 * Retry a function with exponential backoff when rate-limited (429).
 * Non-429 errors are thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, baseDelayMs = BASE_DELAY_MS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimited(error) || attempt === MAX_RETRIES) {
        throw error;
      }
      const delay = baseDelayMs * 2 ** attempt;
      core.warning(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

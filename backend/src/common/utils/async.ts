export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Retry with exponential backoff and jitter. */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  { attempts = 3, baseMs = 500, maxMs = 10_000 }: { attempts?: number; baseMs?: number; maxMs?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(Math.min(baseMs * 2 ** attempt, maxMs) + Math.random() * baseMs);
    }
  }
  throw lastError;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

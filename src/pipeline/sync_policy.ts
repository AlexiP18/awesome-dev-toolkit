/**
 * Política pura de la cola de sincronización con GitHub: serialización, reintentos y firma.
 * No habla con la red ni con el disco.
 */

import crypto from 'crypto';

export interface HeaderBag {
  get(name: string): string | null;
}

export interface SyncResult {
  synced: boolean;
  changedFiles: number;
  commitSha?: string;
  reason?: string;
  retryable?: boolean;
  retryAfterMs?: number;
}

export function isRetryableGitHubStatus(status: number, headers: HeaderBag, body: string): boolean {
  if (status === 409 || status === 422 || status === 429) return true;
  if (status === 500 || status === 502 || status === 503 || status === 504) return true;
  if (status === 403) {
    if (headers.get('x-ratelimit-remaining') === '0') return true;
    if (headers.get('retry-after')) return true;
    if (/rate limit/i.test(body)) return true;
  }
  return false;
}

export function retryDelayMs(attempt: number, retryAfterHeader: string | null, now = Date.now()): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120_000);
    const date = Date.parse(retryAfterHeader);
    if (!Number.isNaN(date)) return Math.min(Math.max(0, date - now), 120_000);
  }
  const exp = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 30_000);
  return exp;
}

export function verifyGitHubSignature(raw: Buffer, secret: string, signature: string | undefined): boolean {
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function shouldClearLocalSyncState(synced: boolean, generationAtRead: number, generationNow: number): boolean {
  return synced && generationAtRead === generationNow;
}

export function createSerialQueue() {
  let tail: Promise<void> = Promise.resolve();

  return {
    run<T>(fn: () => Promise<T>): Promise<T> {
      const run = tail.then(fn, fn);
      tail = run.then(
        () => undefined,
        () => undefined
      );
      return run;
    },
  };
}

interface PushWaiter {
  message: string;
  resolve: (result: SyncResult) => void;
}

/**
 * Une los push encolados en el mismo tick en una sola ejecución y nunca corre dos a la vez.
 * El push debe leer el disco al ejecutarse, no al encolarse, para no perder escrituras.
 */
export function createPushCoalescer(options: { push: (message: string) => Promise<SyncResult> }) {
  let waiters: PushWaiter[] = [];
  let pumping = false;
  let scheduled = false;

  async function pump(): Promise<void> {
    if (pumping) return;
    pumping = true;
    try {
      while (waiters.length > 0) {
        const batch = waiters;
        waiters = [];
        const message = batch[batch.length - 1]?.message || 'chore(catalog): sincronizar';
        let result: SyncResult;
        try {
          result = await options.push(message);
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err);
          result = { synced: false, changedFiles: 0, reason, retryable: true };
        }
        for (const waiter of batch) waiter.resolve(result);
      }
    } finally {
      pumping = false;
      if (waiters.length > 0) void pump();
    }
  }

  return {
    enqueue(message: string): Promise<SyncResult> {
      return new Promise((resolve) => {
        waiters.push({ message, resolve });
        if (!pumping && !scheduled) {
          scheduled = true;
          queueMicrotask(() => {
            scheduled = false;
            void pump();
          });
        }
      });
    },
  };
}

export async function pushWithRetries(
  attemptPush: () => Promise<SyncResult>,
  options?: { maxAttempts?: number; sleep?: (ms: number) => Promise<void> }
): Promise<SyncResult> {
  const max = options?.maxAttempts ?? 4;
  const sleep = options?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let last: SyncResult = { synced: false, changedFiles: 0, reason: 'sin intentos', retryable: true };
  for (let attempt = 1; attempt <= max; attempt++) {
    last = await attemptPush();
    if (last.synced || !last.retryable) return last;
    if (attempt < max) {
      await sleep(last.retryAfterMs ?? retryDelayMs(attempt, null));
    }
  }
  return last;
}

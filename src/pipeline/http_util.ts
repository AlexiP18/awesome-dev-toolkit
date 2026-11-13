/**
 * HTTP pequeño, sin dependencias: timeout, reintentos y logs.
 * Los mensajes nunca deben incluir claves (van en headers, no en la URL).
 */

export function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function safeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-[redacted]').slice(0, 300);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export async function fetchWithRetry(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
  options?: { retries?: number; label?: string }
): Promise<Response> {
  const retries = options?.retries ?? envInt('HTTP_RETRIES', 2);
  const timeoutMs = init.timeoutMs ?? envInt('HTTP_TIMEOUT_MS', 8000);
  const label = options?.label || url;
  const { timeoutMs: _ignored, signal: externalSignal, ...rest } = init;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onExternalAbort = () => controller.abort();
    externalSignal?.addEventListener('abort', onExternalAbort);
    const started = Date.now();
    try {
      const res = await fetch(url, { ...rest, signal: controller.signal });
      const ms = Date.now() - started;
      if (RETRY_STATUSES.has(res.status) && attempt < retries) {
        console.warn(`[HTTP] ${label} intento ${attempt}/${retries} -> HTTP ${res.status} (${ms}ms). Reintentando...`);
        await res.text().catch(() => '');
        await sleep(300 * attempt);
        continue;
      }
      if (attempt > 1) {
        console.log(`[HTTP] ${label} respondió HTTP ${res.status} en el intento ${attempt} (${ms}ms)`);
      }
      return res;
    } catch (err: unknown) {
      lastErr = err;
      const aborted = err instanceof Error && err.name === 'AbortError';
      const reason = aborted ? `timeout ${timeoutMs}ms` : safeErrorMessage(err);
      console.warn(`[HTTP] ${label} intento ${attempt}/${retries} falló: ${reason}`);
      if (attempt >= retries) break;
      await sleep(300 * attempt);
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error(safeErrorMessage(lastErr));
}

export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`[${label}] timeout ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

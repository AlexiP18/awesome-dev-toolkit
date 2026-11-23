/**
 * Logs en una línea JSON. Nunca deben incluir tokens, claves ni cabeceras Authorization.
 */

const SECRET_KEY = /token|secret|password|authorization|api[-_]?key|credential|cookie/i;

export function redact(value: string): string {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\b(ghp_|gho_|github_pat_|sk-|AIza)[A-Za-z0-9_\-]{6,}/g, '[redacted]')
    .replace(/(ADMIN_TOKEN|GITHUB_TOKEN|GITHUB_WEBHOOK_SECRET|GH_TOKEN|[A-Z0-9_]*API_KEY)=([^&\s]+)/gi, '$1=[redacted]');
}

export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redact(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? '[redacted]' : redactValue(inner);
    }
    return out;
  }
  return redact(String(value));
}

export function logEvent(level: 'info' | 'warn' | 'error', msg: string, extra?: Record<string, unknown>): void {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: redact(msg),
    ...(extra ? (redactValue(extra) as Record<string, unknown>) : {}),
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

import crypto from 'crypto';
import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { logEvent, redact } from '../pipeline/log.js';

export class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

const rawBodies = new WeakMap<object, Buffer>();

export function rememberRawBody(req: object, buf: Buffer): void {
  rawBodies.set(req, buf);
}

export function readRawBody(req: object): Buffer | undefined {
  return rawBodies.get(req);
}

export function tokensMatch(provided: string, expected: string): boolean {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function isOriginAllowed(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true;
  const list = (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (list.includes('*') || list.includes(origin)) return true;
  try {
    const url = new URL(origin);
    if (host && url.host === host) return true;
  } catch {
    return false;
  }
  return false;
}

export function publicErrorMessage(err: unknown): { status: number; error: string } {
  if (err instanceof HttpError) {
    return { status: err.status, error: redact(err.message).slice(0, 400) };
  }
  const anyErr = err as { status?: number; statusCode?: number; type?: string; message?: string };
  if (anyErr?.type === 'entity.parse.failed') {
    return { status: 400, error: 'El cuerpo de la petición no es JSON válido.' };
  }
  if (anyErr?.type === 'entity.too.large' || anyErr?.status === 413) {
    return { status: 413, error: 'El cuerpo de la petición es demasiado grande.' };
  }
  const status = anyErr?.status || anyErr?.statusCode;
  if (status === 400 && err instanceof SyntaxError) {
    return { status: 400, error: 'El cuerpo de la petición no es JSON válido.' };
  }
  const message = err instanceof Error ? err.message : 'Error interno del servidor.';
  const safe = redact(message).slice(0, 400) || 'Error interno del servidor.';
  if (typeof status === 'number' && status >= 400 && status < 500) {
    return { status, error: safe };
  }
  return { status: 500, error: safe };
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const parsed = publicErrorMessage(err);
  logEvent(parsed.status >= 500 ? 'error' : 'warn', 'error http', {
    method: req.method,
    path: req.path,
    status: parsed.status,
    error: err instanceof Error ? err.message : String(err),
  });
  if (res.headersSent) return;
  res.status(parsed.status).json({ success: false, error: parsed.error });
};

const MUTATIONS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATIONS.has(req.method)) {
    next();
    return;
  }
  if (req.path === '/api/github/webhook') {
    next();
    return;
  }
  const expected = (process.env.ADMIN_TOKEN || '').trim();
  if (!expected) {
    next();
    return;
  }
  const header = req.get('x-admin-token')?.trim() || '';
  const auth = req.get('authorization') || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(auth)?.[1]?.trim() || '';
  const provided = header || bearer;
  if (provided && tokensMatch(provided, expected)) {
    next();
    return;
  }
  res.status(401).json({
    success: false,
    error: 'No autorizado. Envía la cabecera x-admin-token.',
  });
}

export function createRateLimiter(options: { windowMs: number; max: number; name: string }): RequestHandler {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip || 'unknown'}:${options.name}`;
    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(key, bucket);
    }
    if (buckets.size > 5000) {
      for (const [id, value] of buckets) {
        if (now >= value.resetAt) buckets.delete(id);
      }
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(options.max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
    if (bucket.count > options.max) {
      const retry = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retry));
      res.status(429).json({
        success: false,
        error: 'Demasiadas solicitudes. Espera un momento e inténtalo de nuevo.',
      });
      return;
    }
    next();
  };
}

export function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

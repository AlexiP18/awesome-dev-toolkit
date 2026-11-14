import assert from 'node:assert/strict';
import crypto from 'crypto';
import test from 'node:test';
import { redact } from './log.js';
import {
  createPushCoalescer,
  createSerialQueue,
  isRetryableGitHubStatus,
  pushWithRetries,
  retryDelayMs,
  shouldClearLocalSyncState,
  verifyGitHubSignature,
  type SyncResult,
} from './sync_policy.js';
import { pushCatalogOnce, shouldWritePulledFile, type GitResponse } from './github_sync.js';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): GitResponse {
  const text = JSON.stringify(body);
  return {
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    text: async () => text,
    json: async () => body,
  };
}

test('la cola serial no solapa trabajo', async () => {
  const queue = createSerialQueue();
  const order: string[] = [];
  const first = queue.run(async () => {
    order.push('a1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push('a2');
  });
  const second = queue.run(async () => {
    order.push('b');
  });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['a1', 'a2', 'b']);
});

test('los push del mismo tick se fusionan y el segundo no se pierde', async () => {
  let runs = 0;
  const coalescer = createPushCoalescer({
    push: async (message) => {
      runs += 1;
      assert.equal(message, 'dos');
      return { synced: true, changedFiles: 2, retryable: false };
    },
  });
  const [first, second] = await Promise.all([coalescer.enqueue('uno'), coalescer.enqueue('dos')]);
  assert.equal(runs, 1);
  assert.equal(first.synced, true);
  assert.equal(second.changedFiles, 2);
});

test('un 409 se reintenta y el segundo intento ve la escritura nueva', async () => {
  const files = new Map<string, string>([['content/tools/a.md', 'aaa']]);
  const trees: string[][] = [];
  let patches = 0;
  const headers = { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '0' : null) };

  const request = async (url: string, init?: { method?: string; body?: string }): Promise<GitResponse> => {
    const method = init?.method || 'GET';
    if (url.endsWith('/git/ref/heads/main') && method === 'GET') return jsonResponse(200, { object: { sha: 'basecommit' } });
    if (url.includes('/git/commits/basecommit')) return jsonResponse(200, { tree: { sha: 'basetree' } });
    if (url.includes('/git/trees/basetree')) return jsonResponse(200, { tree: [] });
    if (url.endsWith('/git/trees') && method === 'POST') {
      const body = JSON.parse(init?.body || '{}') as { tree: Array<{ path: string }> };
      trees.push(body.tree.map((item) => item.path));
      return jsonResponse(201, { sha: 'newtree' });
    }
    if (url.endsWith('/git/commits') && method === 'POST') return jsonResponse(201, { sha: 'commit2' });
    if (url.endsWith('/git/refs/heads/main') && method === 'PATCH') {
      patches += 1;
      if (patches === 1) {
        files.set('content/tools/b.md', 'bbb');
        return { status: 409, headers, text: async () => 'fast-forward', json: async () => ({ message: 'fast-forward' }) };
      }
      return jsonResponse(200, { object: { sha: 'commit2' } });
    }
    return jsonResponse(404, { message: url });
  };

  const deleted = new Set<string>(['content/tools/gone.md']);
  const result = await pushWithRetries(
    () =>
      pushCatalogOnce({
        message: 'guardar',
        request,
        repo: 'acme/toolkit',
        branch: 'main',
        token: 'ghp_test_token_value',
        listFiles: () => [...files.keys()],
        readFile: (rel) => {
          const text = files.get(rel);
          return text === undefined ? null : Buffer.from(text);
        },
        deletedPaths: deleted,
      }),
    { maxAttempts: 3, sleep: async () => undefined }
  );

  assert.equal(result.synced, true);
  assert.equal(patches, 2);
  assert.deepEqual(trees[0], ['content/tools/a.md']);
  assert.deepEqual(trees[1], ['content/tools/a.md', 'content/tools/b.md']);
  assert.equal(deleted.has('content/tools/gone.md'), true);
  assert.equal(JSON.stringify(result).includes('ghp_'), false);
});

test('un 401 no se reintenta y el estado local no se da por guardado', async () => {
  let calls = 0;
  const result = await pushWithRetries(async () => {
    calls += 1;
    return { synced: false, changedFiles: 0, reason: 'HTTP 401', retryable: false };
  });
  assert.equal(calls, 1);
  assert.equal(result.retryable, false);
  assert.equal(shouldClearLocalSyncState(false, 1, 1), false);
  assert.equal(shouldClearLocalSyncState(true, 1, 2), false);
  assert.equal(shouldClearLocalSyncState(true, 2, 2), true);
});

test('reintentos de GitHub: 409, 422, 429 y límite; la espera usa Retry-After', () => {
  const headers = { get: (name: string) => (name.toLowerCase() === 'retry-after' ? '2' : name.toLowerCase() === 'x-ratelimit-remaining' ? '0' : null) };
  assert.equal(isRetryableGitHubStatus(409, headers, ''), true);
  assert.equal(isRetryableGitHubStatus(422, headers, ''), true);
  assert.equal(isRetryableGitHubStatus(429, headers, ''), true);
  assert.equal(isRetryableGitHubStatus(403, headers, ''), true);
  assert.equal(isRetryableGitHubStatus(401, { get: () => null }, 'bad credentials'), false);
  assert.equal(retryDelayMs(1, '2'), 2000);
  assert.equal(retryDelayMs(4, null), 8000);
  const deleted = new Set(['content/tools/gone.md']);
  assert.equal(shouldWritePulledFile('content/tools/gone.md', new Set(), deleted), false);
  assert.equal(shouldWritePulledFile('content/tools/nueva.md', new Set(['content/tools/nueva.md']), new Set()), false);
  assert.equal(shouldWritePulledFile('content/tools/nueva.md', new Set(), new Set()), true);
});

test('la firma del webhook y el redactado no aceptan un secreto a medias', () => {
  const raw = Buffer.from('{"ref":"refs/heads/main"}');
  const good = `sha256=${crypto.createHmac('sha256', 'whsec').update(raw).digest('hex')}`;
  assert.equal(verifyGitHubSignature(raw, 'whsec', good), true);
  assert.equal(verifyGitHubSignature(raw, 'whsec', `${good}x`), false);
  assert.equal(verifyGitHubSignature(raw, 'otro', good), false);
  const cleaned = redact('Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz y sk-abcdefghijklmnopqrstuvwxyz');
  assert.equal(cleaned.includes('ghp_'), false);
  assert.equal(cleaned.includes('sk-'), false);
});

test('un fallo retryable no resuelve hasta el último intento', async () => {
  const waits: number[] = [];
  let attempt = 0;
  const result: SyncResult = await pushWithRetries(
    async () => {
      attempt += 1;
      return { synced: false, changedFiles: 0, reason: 'HTTP 409', retryable: true };
    },
    {
      maxAttempts: 3,
      sleep: async (ms) => {
        waits.push(ms);
      },
    }
  );
  assert.equal(attempt, 3);
  assert.equal(result.synced, false);
  assert.deepEqual(waits, [1000, 2000]);
});

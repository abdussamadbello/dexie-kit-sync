import { describe, it, expect, vi, afterEach } from 'vitest';
import Dexie from 'dexie';
import { startSync, defineRoutes } from '../src/index';

function jsonResponse(body: any, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function makeDb(): Dexie {
  const db = new Dexie('push-test-' + Math.random());
  db.version(1).stores({ posts: '++id, title, updatedAt' });
  return db;
}

// Change tracking writes to the outbox from a microtask queued inside the
// Dexie hook that observed the change (it can't write synchronously — the
// hook runs inside the transaction of the mutation being tracked, which is
// scoped only to that table). Tests that push() immediately after a tracked
// mutation give that microtask a moment to land first.
function flushTracking(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('push processing', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('pushes a delete without crashing, using the README-documented url callback', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb();
    const routes = defineRoutes({
      posts: {
        push: {
          delete: {
            method: 'DELETE',
            url: (item) => `/api/posts/${item.id}`,
          },
        },
      },
    });

    const engine = startSync(db, {
      baseUrl: 'https://api.example.com',
      routes,
      auth: { getHeaders: () => ({}) },
    });

    await db.open();
    // Created before start() so change tracking isn't active yet — this test
    // isolates the delete path, which has no push.create route configured.
    const id = await db.table('posts').add({ title: 'to delete' });
    await engine.start();

    await db.table('posts').delete(id);
    await flushTracking();
    const result = await engine.push();

    expect(result.success).toBe(true);
    expect(result.pushed).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/posts/${id}`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('pushes create-then-update for the same record in order, never concurrently', async () => {
    let resolveCreate!: (response: Response) => void;
    const createResponse = new Promise<Response>((resolve) => {
      resolveCreate = resolve;
    });

    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => createResponse)
      .mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb();
    const routes = defineRoutes({
      posts: {
        push: {
          create: { method: 'POST', url: '/api/posts', body: (item) => item },
          update: { method: 'PUT', url: (item) => `/api/posts/${item.id}`, body: (item) => item },
        },
      },
    });

    const engine = startSync(db, {
      baseUrl: 'https://api.example.com',
      routes,
      auth: { getHeaders: () => ({}) },
      sync: { push: { concurrency: 3, batchSize: 10 } },
    });

    await db.open();
    await engine.start();

    const id = await db.table('posts').add({ title: 'v1' });
    await db.table('posts').update(id, { title: 'v2' });
    await db.table('posts').update(id, { title: 'v3' });

    const pushPromise = engine.push();

    // The create request is still pending, so the queued updates for this
    // same record must not have been dispatched yet.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/posts',
      expect.objectContaining({ method: 'POST' })
    );

    resolveCreate(jsonResponse({ id, title: 'v1' }));
    const result = await pushPromise;

    expect(result.pushed).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('merges the create response back onto the local record', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 'server-does-not-change-id', version: 7 }));
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb();
    const routes = defineRoutes({
      posts: {
        push: {
          create: { method: 'POST', url: '/api/posts', body: (item) => item },
        },
      },
    });

    const engine = startSync(db, {
      baseUrl: 'https://api.example.com',
      routes,
      auth: { getHeaders: () => ({}) },
    });

    await db.open();
    await engine.start();

    const id = await db.table('posts').add({ title: 'v1' });
    await flushTracking();
    await engine.push();

    const stored = await db.table('posts').get(id);
    expect(stored.title).toBe('v1');
    expect(stored.version).toBe(7);
    // The primary-key field is stripped from the merge, so the local id is
    // unchanged even though the (contrived) server response included one —
    // otherwise Dexie would read that as "the key changed" and delete+recreate
    // the record under the server's id instead of updating it in place.
    expect(stored.id).toBe(id);
  });

  it('moves a non-retryable failure to the dead-letter queue and records metrics', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ message: 'nope' }), { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb();
    const routes = defineRoutes({
      posts: {
        push: {
          create: { method: 'POST', url: '/api/posts', body: (item) => item },
        },
      },
    });

    const engine = startSync(db, {
      baseUrl: 'https://api.example.com',
      routes,
      auth: { getHeaders: () => ({}) },
    });

    await db.open();
    await engine.start();

    await db.table('posts').add({ title: 'bad' });

    const result = await engine.push();
    expect(result.success).toBe(false);
    expect(result.failed).toBe(1);

    const deadLetters = await engine.getDeadLetters();
    expect(deadLetters).toHaveLength(1);
    expect(deadLetters[0].errorType).toBe('validation');

    const metrics = await engine.getMetrics();
    expect(metrics.errors.total).toBe(1);
    expect(metrics.errors.deadLetterCount).toBe(1);
    expect(metrics.network.requestCount).toBe(1);
  });

  it('skips paused tables when pushing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb();
    const routes = defineRoutes({
      posts: {
        push: {
          create: { method: 'POST', url: '/api/posts', body: (item) => item },
        },
      },
    });

    const engine = startSync(db, {
      baseUrl: 'https://api.example.com',
      routes,
      auth: { getHeaders: () => ({}) },
    });

    await db.open();
    await engine.start();
    await engine.pauseTable('posts');

    await db.table('posts').add({ title: 'should not sync yet' });

    const result = await engine.push();

    expect(result.pushed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await engine.getQueueDepth('posts')).toBe(1);

    await engine.resumeTable('posts');
    const resumedResult = await engine.push();
    expect(resumedResult.pushed).toBe(1);
  });

  it('throttles pushes to a table according to its configured rateLimit', async () => {
    // mockImplementation (not mockResolvedValue) so each call gets a fresh
    // Response — a Response body can only be read once.
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const db = makeDb();
    const routes = defineRoutes({
      posts: {
        push: {
          create: { method: 'POST', url: '/api/posts', body: (item) => item },
          rateLimit: { maxRequests: 1, windowMs: 100 },
        },
      },
    });

    const engine = startSync(db, {
      baseUrl: 'https://api.example.com',
      routes,
      auth: { getHeaders: () => ({}) },
    });

    await db.open();
    await engine.start();

    await db.table('posts').add({ title: 'a' });
    await db.table('posts').add({ title: 'b' });
    await flushTracking();

    const start = Date.now();
    const result = await engine.push();
    const elapsed = Date.now() - start;

    expect(result.pushed).toBe(2);
    // With maxRequests: 1 per 100ms, the second create must wait out the window.
    expect(elapsed).toBeGreaterThanOrEqual(90);
  });
});

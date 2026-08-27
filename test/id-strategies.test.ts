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

// See the note on this pattern in test/push-processor.test.ts — change
// tracking writes to the outbox from a microtask, so tests that push()
// immediately after a mutation give it a moment to land first.
function flushTracking(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

describe('id strategies', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('warns when a synced table still uses a Dexie auto-incrementing key', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const db = new Dexie('warn-auto-' + Math.random());
    db.version(1).stores({ posts: '++id, title' });

    startSync(db, {
      baseUrl: 'https://api.example.com',
      routes: defineRoutes({ posts: { push: {} } }),
      auth: { getHeaders: () => ({}) },
    });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('posts');
    expect(warnSpy.mock.calls[0][0]).toContain('auto-incrementing');
  });

  it('does not warn for a client-generated (non-auto) primary key', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const db = new Dexie('no-warn-' + Math.random());
    db.version(1).stores({ posts: 'id, title' });

    startSync(db, {
      baseUrl: 'https://api.example.com',
      routes: defineRoutes({ posts: { push: {} } }),
      auth: { getHeaders: () => ({}) },
    });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('Pattern 1: a client-generated id needs no reconciliation — same id locally and on the server', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, options: any) => {
      const sent = JSON.parse(options.body);
      return jsonResponse({ ...sent, updatedAt: 12345 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const db = new Dexie('pattern1-' + Math.random());
    db.version(1).stores({ posts: 'id, title, updatedAt' }); // no ++ — id is client-assigned

    const routes = defineRoutes({
      posts: {
        push: {
          create: { method: 'POST', url: '/api/posts', body: (item) => item },
          update: { method: 'PUT', url: (item) => `/api/posts/${item.id}`, body: (item) => item },
          delete: { method: 'DELETE', url: (item) => `/api/posts/${item.id}` },
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

    const id = crypto.randomUUID();
    await db.table('posts').add({ id, title: 'hello' });
    await flushTracking();
    await engine.push();

    const stored = await db.table('posts').get(id);
    expect(stored.id).toBe(id); // never changed — no server round trip needed to know it
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/posts',
      expect.objectContaining({ method: 'POST' })
    );

    await db.table('posts').update(id, { title: 'updated' });
    await flushTracking();
    await engine.push();
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/posts/${id}`,
      expect.objectContaining({ method: 'PUT' })
    );

    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    await db.table('posts').delete(id);
    await flushTracking();
    const deleteResult = await engine.push();

    expect(deleteResult.pushed).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/posts/${id}`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('Pattern 2: a server-assigned id in a separate field is used for later requests, including delete', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const db = new Dexie('pattern2-' + Math.random());
    db.version(1).stores({ posts: 'id, title, serverId' });

    const routes = defineRoutes({
      posts: {
        push: {
          create: { method: 'POST', url: '/api/posts', body: (item) => item },
          // Prefer the server's own id once known; fall back to the client id
          // for anything not yet synced.
          delete: { method: 'DELETE', url: (item) => `/api/posts/${item.serverId ?? item.id}` },
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

    const clientId = crypto.randomUUID();
    fetchMock.mockImplementationOnce(async () => jsonResponse({ serverId: 999 }));
    await db.table('posts').add({ id: clientId, title: 'hi' });
    await flushTracking();
    await engine.push();

    const stored = await db.table('posts').get(clientId);
    expect(stored.id).toBe(clientId); // local key never changes
    expect(stored.serverId).toBe(999); // server's own id merged in separately

    fetchMock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
    await db.table('posts').delete(clientId);
    await flushTracking();
    const result = await engine.push();

    expect(result.pushed).toBe(1);
    // Addressed by the server's id, not the local client id.
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/api/posts/999',
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('drops a record entirely if it is created and deleted before ever syncing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const db = new Dexie('cancel-' + Math.random());
    db.version(1).stores({ posts: 'id, title' });

    const routes = defineRoutes({
      posts: {
        push: {
          create: { method: 'POST', url: '/api/posts', body: (item) => item },
          delete: { method: 'DELETE', url: (item) => `/api/posts/${item.id}` },
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

    const id = crypto.randomUUID();
    await db.table('posts').add({ id, title: 'ephemeral' });
    await db.table('posts').delete(id);
    await flushTracking();

    expect(await engine.getQueueDepth()).toBe(0);

    const result = await engine.push();
    expect(result.pushed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('still pushes a delete normally once the create has already synced', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const db = new Dexie('already-synced-' + Math.random());
    db.version(1).stores({ posts: 'id, title' });

    const routes = defineRoutes({
      posts: {
        push: {
          create: { method: 'POST', url: '/api/posts', body: (item) => item },
          delete: { method: 'DELETE', url: (item) => `/api/posts/${item.id}` },
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

    const id = crypto.randomUUID();
    await db.table('posts').add({ id, title: 'will be deleted later' });
    await flushTracking();
    await engine.push(); // create syncs and leaves the outbox

    await db.table('posts').delete(id);
    await flushTracking();

    expect(await engine.getQueueDepth()).toBe(1); // the delete is still queued
    const result = await engine.push();

    expect(result.pushed).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.example.com/api/posts/${id}`,
      expect.objectContaining({ method: 'DELETE' })
    );
  });
});

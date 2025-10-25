import { describe, it, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { startSync, defineRoutes } from '../src/index';

describe('dexie-sync-kit', () => {
  let db: Dexie;

  beforeEach(async () => {
    db = new Dexie('test-db-' + Math.random());
    db.version(1).stores({
      posts: '++id, title, updatedAt',
    });
  });

  it('should export main functions', () => {
    expect(startSync).toBeDefined();
    expect(defineRoutes).toBeDefined();
  });

  it('should create sync engine', () => {
    const routes = defineRoutes({
      posts: {
        push: {
          create: {
            method: 'POST',
            url: '/api/posts',
          },
        },
        pull: {
          method: 'GET',
          url: '/api/posts',
        },
      },
    });

    const syncEngine = startSync(db, {
      baseUrl: 'https://api.example.com',
      routes,
      auth: {
        getHeaders: () => ({}),
      },
    });

    expect(syncEngine).toBeDefined();
    expect(syncEngine.start).toBeDefined();
    expect(syncEngine.sync).toBeDefined();
  });

  it('should add sync tables to database', async () => {
    const routes = defineRoutes({
      posts: {
        push: {
          create: {
            method: 'POST',
            url: '/api/posts',
          },
        },
      },
    });

    startSync(db, {
      baseUrl: 'https://api.example.com',
      routes,
      auth: {
        getHeaders: () => ({}),
      },
    });

    await db.open();

    const tableNames = db.tables.map((t) => t.name);
    expect(tableNames).toContain('outbox');
    expect(tableNames).toContain('checkpoints');
    expect(tableNames).toContain('deadLetters');
  });

  it('should provide getStatus method', async () => {
    const routes = defineRoutes({
      posts: {
        push: {
          create: {
            method: 'POST',
            url: '/api/posts',
          },
        },
      },
    });

    const syncEngine = startSync(db, {
      baseUrl: 'https://api.example.com',
      routes,
      auth: {
        getHeaders: () => ({}),
      },
    });

    const status = syncEngine.getStatus();
    expect(status).toBeDefined();
    expect(status.isRunning).toBe(false);
    expect(status.isPaused).toBe(false);
  });
});

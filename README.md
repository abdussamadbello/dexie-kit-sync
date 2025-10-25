# dexie-sync-kit

> Offline-first sync framework for Dexie.js with REST API support

[![npm version](https://img.shields.io/npm/v/dexie-sync-kit.svg)](https://www.npmjs.com/package/dexie-sync-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- ✅ **REST API Sync** - Works with any REST backend (no special database required)
- ✅ **Offline Queue** - Automatically queues changes when offline
- ✅ **Conflict Resolution** - Built-in strategies (LWW, server-wins, client-wins, custom)
- ✅ **Multi-tab Safe** - Leader election ensures single-tab sync
- ✅ **Smart Retry** - Exponential backoff with dead letter queue
- ✅ **TypeScript First** - Full type safety and inference
- ✅ **Observability** - Metrics, events, and health checks
- ✅ **Zero Backend Changes** - Works with existing REST APIs

## Installation

```bash
npm install dexie-sync-kit dexie
```

## Quick Start

```typescript
import Dexie from 'dexie';
import { startSync, defineRoutes } from 'dexie-sync-kit';

// 1. Define your database
const db = new Dexie('myapp');
db.version(1).stores({
  posts: '++id, title, updatedAt',
  comments: '++id, postId, content, updatedAt',
});

// 2. Configure sync routes
const routes = defineRoutes({
  posts: {
    push: {
      create: {
        method: 'POST',
        url: '/api/posts',
        body: (item) => item,
      },
      update: {
        method: 'PUT',
        url: (item) => `/api/posts/${item.id}`,
        body: (item) => item,
      },
      delete: {
        method: 'DELETE',
        url: (item) => `/api/posts/${item.id}`,
      },
    },
    pull: {
      method: 'GET',
      url: '/api/posts',
      query: async (ctx) => ({
        updated_after: await ctx.getCheckpoint('pull:posts') || 0,
      }),
      mapResponse: (response) => response.data,
      onComplete: async (response, ctx) => {
        const latest = Math.max(
          ...response.data.map(p => new Date(p.updatedAt).getTime())
        );
        await ctx.setCheckpoint('pull:posts', latest);
      },
    },
  },
});

// 3. Start sync
const syncEngine = startSync(db, {
  baseUrl: 'https://api.example.com',
  
  auth: {
    getHeaders: async () => ({
      'Authorization': `Bearer ${await getToken()}`,
    }),
  },
  
  routes,
  
  conflicts: {
    policy: 'server-wins',
  },
  
  sync: {
    interval: 30000, // Sync every 30 seconds
    onOnline: true,  // Sync when coming online
  },
});

// 4. Use your app normally
await db.posts.add({ title: 'Hello World' });

// Sync happens automatically!
await syncEngine.start();
```

## Core Concepts

### Outbox Pattern

All local changes are tracked in an outbox queue. When online, changes are pushed to the server.

### Checkpoints

Track the last sync point for each table to enable delta sync (only fetch what changed).

### Conflict Resolution

When the same record is modified both locally and on the server, conflicts are resolved using:

- **server-wins** - Server version always wins (safest)
- **client-wins** - Client version always wins (use with caution)
- **lww** - Last-write-wins based on timestamps
- **custom** - Your own resolution function

### Leader Election

Only one browser tab performs sync to avoid race conditions. Uses BroadcastChannel API.

## API Reference

### `startSync(db, config)`

Starts sync for a Dexie database.

**Parameters:**
- `db: Dexie` - Your Dexie database instance
- `config: SyncConfig` - Sync configuration

**Returns:** `SyncEngine`

### SyncEngine Methods

```typescript
// Lifecycle
await syncEngine.start();
await syncEngine.stop();
await syncEngine.pause();
await syncEngine.resume();

// Manual sync
const result = await syncEngine.sync();
await syncEngine.push();
await syncEngine.pull();
await syncEngine.syncTable('posts');

// Status
const status = syncEngine.getStatus();
const isOnline = syncEngine.isOnline();
const isSyncing = syncEngine.isSyncing();
const depth = await syncEngine.getQueueDepth();

// Events
syncEngine.on('sync-complete', (result) => {
  console.log('Synced!', result);
});

// Advanced
const health = await syncEngine.healthCheck();
const deadLetters = await syncEngine.getDeadLetters();
await syncEngine.retryDeadLetter(id);
```

### Events

- `sync-start` - Sync started
- `sync-complete` - Sync completed
- `sync-error` - Sync failed
- `push-start` - Push started
- `push-complete` - Push completed
- `push-error` - Push failed
- `pull-start` - Pull started
- `pull-complete` - Pull completed
- `pull-error` - Pull failed
- `conflict` - Conflict detected
- `online` - Network online
- `offline` - Network offline
- `metrics` - Metrics update

## Configuration

### Full Configuration Example

```typescript
startSync(db, {
  baseUrl: 'https://api.example.com',
  
  routes: {
    // ... route config
  },
  
  auth: {
    getHeaders: async () => ({
      'Authorization': `Bearer ${token}`,
    }),
    onAuthError: async (error) => {
      if (error.status === 401) {
        await refreshToken();
      }
    },
    maxAuthRetries: 3,
  },
  
  sync: {
    interval: 30000,
    onOnline: true,
    onVisibilityChange: true,
    
    push: {
      batchSize: 10,
      concurrency: 3,
    },
    
    pull: {
      pageSize: 100,
      maxPages: 10,
    },
  },
  
  conflicts: {
    policy: 'lww',
    onConflict: async (conflict) => {
      // Custom resolution
      return conflict.remote;
    },
  },
  
  errors: {
    maxRetries: 5,
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 60000),
  },
  
  observability: {
    enabled: true,
    metricsInterval: 30000,
    onMetrics: (metrics) => {
      console.log('Metrics:', metrics);
    },
  },
});
```

## Backend Requirements

Your REST API needs:

1. **CRUD endpoints** for each resource
2. **Timestamp field** (e.g., `updatedAt`) for delta queries
3. **Timestamp filtering** (e.g., `?updated_after=1234567890`)
4. **Standard HTTP status codes**

### Example Backend (Express.js)

```typescript
app.get('/api/posts', async (req, res) => {
  const { updated_after = '0' } = req.query;
  
  const posts = await db.posts.findMany({
    where: {
      updatedAt: { gt: new Date(Number(updated_after)) }
    },
    orderBy: { updatedAt: 'asc' }
  });
  
  res.json({ data: posts });
});

app.post('/api/posts', async (req, res) => {
  const post = await db.posts.create({
    data: { ...req.body, updatedAt: new Date() }
  });
  res.status(201).json(post);
});

app.put('/api/posts/:id', async (req, res) => {
  const post = await db.posts.update({
    where: { id: req.params.id },
    data: { ...req.body, updatedAt: new Date() }
  });
  res.json(post);
});

app.delete('/api/posts/:id', async (req, res) => {
  await db.posts.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
```

## Examples

See the [examples](./examples) directory for complete working examples:

- React + Vite
- Next.js
- Express backend
- FastAPI backend

## License

MIT © Abdussamad Bello

## Contributing

Contributions welcome! Please read the [contributing guide](./CONTRIBUTING.md).

## Roadmap

- [ ] Service Worker integration
- [ ] WebSocket real-time sync plugin
- [ ] CRDT support for collaborative editing
- [ ] React hooks for sync state
- [ ] Vue composables
- [ ] Svelte stores

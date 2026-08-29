# @dexie-kit/sync

> Offline-first sync framework for Dexie.js with REST API support

[![npm version](https://img.shields.io/npm/v/@dexie-kit/sync.svg)](https://www.npmjs.com/package/@dexie-kit/sync)
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
npm install @dexie-kit/sync dexie
```

## Quick Start

```typescript
import Dexie from 'dexie';
import { startSync, defineRoutes } from '@dexie-kit/sync';

// 1. Define your database. Primary keys are client-generated (no `++`) —
// see "ID Strategies" below for why.
const db = new Dexie('myapp');
db.version(1).stores({
  posts: 'id, title, updatedAt',
  comments: 'id, postId, content, updatedAt',
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

// 4. Use your app normally — the id is assigned on the client
await db.posts.add({ id: crypto.randomUUID(), title: 'Hello World' });

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

## ID Strategies

A record's primary key has to mean the same thing locally and on the server, or updates and deletes end up addressing the wrong resource (or one that doesn't exist yet). The way to guarantee that is to **generate the id on the client** and use it as the Dexie primary key, instead of letting Dexie auto-increment it (`++id`):

```typescript
db.version(1).stores({
  posts: 'id, title, updatedAt', // no `++` — the app assigns `id`
});

await db.posts.add({ id: crypto.randomUUID(), title: 'Hello World' });
```

This is the pattern used by most offline-first sync systems (PouchDB/CouchDB, RxDB, WatermelonDB, etc.), for good reason:

- The id is known **immediately**, before the record ever reaches the network — so a `comments` row can reference its parent `post.id` correctly even while both are still offline.
- There's only ever one id for a record. Nothing needs to be reconciled after a push succeeds.
- Collisions are practically impossible (a `crypto.randomUUID()` has 122 bits of randomness).

If a table used for sync still has an auto-incrementing key, `startSync()` logs a console warning — that's your cue to migrate it.

### Pattern 1 (recommended): the client id is the record's id everywhere

Send the client-generated id on create, and have your backend store it as the record's own primary key rather than generating one:

```typescript
// Express + Prisma
app.post('/api/posts', async (req, res) => {
  const post = await db.posts.create({
    data: { id: req.body.id, title: req.body.title, updatedAt: new Date() },
  });
  res.status(201).json(post);
});
```

Nothing needs to be mapped back — `item.id` is correct for every later update/delete.

### Pattern 2: the backend can't accept a client-supplied id

Some backends can't take an externally-supplied primary key (e.g. a legacy table with its own auto-increment sequence). In that case, keep the client id as the **permanent local key** — it's still what the rest of your app, and any local foreign keys, use — and have the server return its own id under a *different* field:

```typescript
// Server: correlate by the client's id, but keep its own primary key
app.post('/api/posts', async (req, res) => {
  const post = await db.posts.create({
    data: { clientId: req.body.id, title: req.body.title, updatedAt: new Date() },
  });
  res.status(201).json({ serverId: post.id, updatedAt: post.updatedAt });
});
```

```typescript
// Client: prefer the server id once known, fall back to the client id
// for anything that hasn't synced yet
const routes = defineRoutes({
  posts: {
    push: {
      create: { method: 'POST', url: '/api/posts', body: (item) => item },
      update: {
        method: 'PUT',
        url: (item) => `/api/posts/${item.serverId ?? item.id}`,
        body: (item) => item,
      },
      delete: {
        method: 'DELETE',
        url: (item) => `/api/posts/${item.serverId ?? item.id}`,
      },
    },
  },
});
```

The server's response is automatically merged back onto the local record (its `serverId` field, in this example) after every successful push — you don't need to do anything else to wire this up. A record created and deleted before it's ever pushed is dropped from the queue entirely rather than synced, so there's no window where a delete has to guess at a `serverId` that was never assigned.

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
5. **Accept the client-generated `id`** on create (see [ID Strategies](#id-strategies)) — or return your own id under a different field if it can't

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
  // req.body.id is the client-generated id — the `id` column must accept an
  // externally-supplied value rather than auto-incrementing.
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

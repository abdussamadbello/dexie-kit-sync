# Basic Usage Example

This example demonstrates the basic usage of @dexie-kit/sync.

## Setup

```typescript
import Dexie from 'dexie';
import { startSync, defineRoutes } from '@dexie-kit/sync';

// 1. Define your database
const db = new Dexie('myapp');
db.version(1).stores({
  posts: '++id, title, content, updatedAt, version',
  comments: '++id, postId, content, updatedAt',
});

// 2. Configure routes
const routes = defineRoutes({
  posts: {
    // Push configuration (local -> server)
    push: {
      create: {
        method: 'POST',
        url: '/api/posts',
        body: (item) => ({
          title: item.title,
          content: item.content,
          updatedAt: item.updatedAt,
        }),
      },
      update: {
        method: 'PUT',
        url: (item) => `/api/posts/${item.id}`,
        body: (item) => ({
          title: item.title,
          content: item.content,
          updatedAt: item.updatedAt,
          version: item.version,
        }),
      },
      delete: {
        method: 'DELETE',
        url: (item) => `/api/posts/${item.id}`,
      },
    },

    // Pull configuration (server -> local)
    pull: {
      method: 'GET',
      url: '/api/posts',
      query: async (ctx) => {
        const lastSync = await ctx.getCheckpoint('pull:posts');
        return {
          updated_after: lastSync || 0,
          limit: 100,
        };
      },
      mapResponse: (response) => response.data,
      onComplete: async (response, ctx) => {
        if (response.data.length > 0) {
          const latest = Math.max(
            ...response.data.map((p: any) => new Date(p.updatedAt).getTime())
          );
          await ctx.setCheckpoint('pull:posts', latest);
        }
      },
    },
  },
});

// 3. Start sync
const syncEngine = startSync(db, {
  baseUrl: 'https://api.example.com',
  
  auth: {
    getHeaders: async () => {
      // Get your auth token
      const token = localStorage.getItem('auth_token');
      return {
        'Authorization': `Bearer ${token}`,
      };
    },
    onAuthError: async (error) => {
      if (error.status === 401) {
        // Refresh token or redirect to login
        console.log('Auth error, please login again');
      }
    },
  },
  
  routes,
  
  conflicts: {
    policy: 'server-wins', // or 'client-wins', 'lww', 'custom'
  },
  
  sync: {
    interval: 30000, // Sync every 30 seconds
    onOnline: true,  // Sync when coming online
  },
});

// 4. Start the sync engine
await syncEngine.start();

// 5. Use your app normally
await db.posts.add({
  title: 'My First Post',
  content: 'Hello World!',
  updatedAt: new Date().toISOString(),
  version: 1,
});

// Changes are automatically queued and synced!

// Listen to events
syncEngine.on('sync-complete', (result) => {
  console.log('Sync complete:', result);
  console.log(`Pushed: ${result.push.pushed}, Pulled: ${result.pull.pulled}`);
});

syncEngine.on('sync-error', (error) => {
  console.error('Sync failed:', error);
});

// Manually trigger sync
await syncEngine.sync();

// Check status
const status = syncEngine.getStatus();
console.log('Status:', status);

// Get metrics
const metrics = await syncEngine.getMetrics();
console.log('Queue depth:', metrics.queue.depth);
console.log('Last sync:', new Date(metrics.sync.lastSyncCompleted));
```

## Backend Requirements

Your REST API should support:

```javascript
// GET /api/posts?updated_after=1234567890&limit=100
app.get('/api/posts', async (req, res) => {
  const { updated_after = '0', limit = '100' } = req.query;
  
  const posts = await db.posts.findMany({
    where: {
      updatedAt: { gt: new Date(Number(updated_after)) }
    },
    orderBy: { updatedAt: 'asc' },
    take: Number(limit)
  });
  
  res.json({ data: posts });
});

// POST /api/posts
app.post('/api/posts', async (req, res) => {
  const post = await db.posts.create({
    data: {
      ...req.body,
      updatedAt: new Date(),
      version: 1
    }
  });
  res.status(201).json(post);
});

// PUT /api/posts/:id
app.put('/api/posts/:id', async (req, res) => {
  const { expectedVersion, ...data } = req.body;
  
  const current = await db.posts.findUnique({ 
    where: { id: req.params.id } 
  });
  
  if (!current) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  // Check version for conflict detection
  if (expectedVersion && current.version !== expectedVersion) {
    return res.status(409).json({
      error: 'Version conflict',
      serverVersion: current.version,
      serverData: current
    });
  }
  
  const updated = await db.posts.update({
    where: { id: req.params.id },
    data: {
      ...data,
      version: current.version + 1,
      updatedAt: new Date()
    }
  });
  
  res.json(updated);
});

// DELETE /api/posts/:id
app.delete('/api/posts/:id', async (req, res) => {
  await db.posts.delete({ where: { id: req.params.id } });
  res.status(204).send();
});
```

## Advanced Features

### Custom Conflict Resolution

```typescript
startSync(db, {
  // ... other config
  conflicts: {
    policy: 'custom',
    onConflict: async (conflict) => {
      const { table, key, local, remote } = conflict;
      
      // Custom merge logic
      return {
        ...remote,
        title: local.title, // Keep local title
        content: remote.content // Use server content
      };
    }
  }
});
```

### Monitoring

```typescript
// Health check
const health = await syncEngine.healthCheck();
if (!health.healthy) {
  console.warn('Sync issues:', health.issues);
}

// Dead letter queue
const deadLetters = await syncEngine.getDeadLetters();
console.log('Failed items:', deadLetters);

// Retry failed items
for (const item of deadLetters) {
  await syncEngine.retryDeadLetter(item.id);
}
```

### Table-specific Control

```typescript
// Pause specific table
await syncEngine.pauseTable('posts');

// Resume specific table
await syncEngine.resumeTable('posts');

// Sync specific table only
await syncEngine.syncTable('posts');
```

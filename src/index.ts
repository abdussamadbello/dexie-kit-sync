import type Dexie from 'dexie';
import type { SyncConfig, SyncEngine as ISyncEngine, RouteConfiguration } from './core/types';
import { SyncEngine } from './core/sync-engine';

/**
 * Start sync for a Dexie database
 */
export function startSync(db: Dexie, config: SyncConfig): ISyncEngine {
  // Ensure sync tables exist
  ensureSyncTables(db);

  return new SyncEngine(db, config);
}

/**
 * Helper to define routes with type safety
 */
export function defineRoutes(routes: RouteConfiguration): RouteConfiguration {
  return routes;
}

/**
 * Ensure sync metadata tables are added to the database
 */
function ensureSyncTables(db: Dexie) {
  // Check if sync tables are already defined
  const existingTables = db.tables.map((t) => t.name);

  const syncTables = ['outbox', 'checkpoints', 'deadLetters'];
  const missingTables = syncTables.filter((t) => !existingTables.includes(t));

  if (missingTables.length > 0) {
    // Get current version
    const currentVersion = db.verno || 0;

    // Get existing schema
    const existingSchema: Record<string, string> = {};
    db.tables.forEach((table) => {
      const schema = table.schema;
      const indexes = [schema.primKey.src];
      schema.indexes.forEach((idx) => indexes.push(idx.src!));
      existingSchema[table.name] = indexes.join(', ');
    });

    // Add sync tables in a new version
    db.version(currentVersion + 1).stores({
      ...existingSchema,
      outbox: '++id, table, operation, key, createdAt, attempt, nextRetryAt',
      checkpoints: 'scope, revision, updatedAt',
      deadLetters: '++id, table, key, failedAt, [table+key]',
    });
  }
}

// Export types
export type {
  SyncConfig,
  SyncEngine,
  RouteConfiguration,
  SyncResult,
  PushResult,
  PullResult,
  SyncStatus,
  SyncMetrics,
  SyncEvent,
  EventHandler,
  OutboxItem,
  Checkpoint,
  DeadLetterItem,
  ConflictInfo,
  ConflictPolicy,
  SyncError,
  AuthError,
  ConflictError,
  HealthCheckResult,
} from './core/types';

// Re-export conflict strategies
export { serverWins, clientWins, lastWriteWins } from './conflict/strategies';

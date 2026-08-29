import type Dexie from 'dexie';
import type { SyncConfig, SyncEngine as ISyncEngine, RouteConfiguration } from './core/types';
import { SyncEngine } from './core/sync-engine';

/**
 * Start sync for a Dexie database
 */
export function startSync(db: Dexie, config: SyncConfig): ISyncEngine {
  // Ensure sync tables exist
  ensureSyncTables(db);
  warnAboutAutoIncrementKeys(db, config);

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

/**
 * Warn about synced tables using a Dexie auto-incrementing primary key
 * (e.g. '++id'). The id isn't known until *after* the local write, and a
 * server that assigns its own id on create has no way to be linked back to
 * it — later updates/deletes would then address the wrong record, or one
 * that doesn't exist. A client-generated id (e.g. crypto.randomUUID())
 * avoids this entirely. See the "ID Strategies" section of the README.
 */
function warnAboutAutoIncrementKeys(db: Dexie, config: SyncConfig) {
  const tablesByName = new Map(db.tables.map((table) => [table.name, table]));

  for (const tableName of Object.keys(config.routes)) {
    const table = tablesByName.get(tableName);
    if (table?.schema.primKey.auto) {
      console.warn(
        `[@dexie-kit/sync] Table "${tableName}" uses an auto-incrementing primary key. ` +
          `Its id isn't known until after the local write, so once a create is pushed, ` +
          `the server's assigned id can't be linked back to it — later updates/deletes ` +
          `may target the wrong record. Use a client-generated id instead ` +
          `(e.g. crypto.randomUUID()) — see the "ID Strategies" section of the README.`
      );
    }
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

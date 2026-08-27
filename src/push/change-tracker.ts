import type Dexie from 'dexie';
import type { Transaction } from 'dexie';
import type { Operation } from '../core/types';
import { OutboxManager } from './outbox-manager';

/**
 * Transactions in this set are the sync engine's own writes (e.g. merging a
 * server response back onto a record after a push). Change tracking skips
 * them, since re-tracking our own reconciliation write would queue it as a
 * new outbox item and push it right back to the server forever.
 */
export const reconciliationTransactions = new WeakSet<Transaction>();

export class ChangeTracker {
  private outboxManager: OutboxManager;
  private hooks: Map<string, any> = new Map();

  constructor(private db: Dexie) {
    this.outboxManager = new OutboxManager(db);
  }

  startTracking(tables: string[]) {
    tables.forEach((tableName) => {
      const table = this.db.table(tableName);
      if (!table) return;

      const trackChange = (operation: Operation, key: any, obj?: any) =>
        this.trackChange(tableName, operation, key, obj);

      // Hook into creating. For auto-incrementing primary keys, `primKey` is
      // not yet known at this point — Dexie only exposes the generated key
      // via `this.onsuccess` once the write completes. Using `primKey`
      // directly here would record the create with an undefined key, which
      // would never match the real id that later update/delete hooks report
      // for the same record.
      const creatingHook = table.hook('creating', function (primKey, obj, transaction) {
        if (reconciliationTransactions.has(transaction)) return;
        this.onsuccess = (generatedKey) => {
          trackChange('create', generatedKey ?? primKey, obj);
        };
      });

      // Hook into updating
      const updatingHook = table.hook('updating', (modifications, primKey, obj, transaction) => {
        if (reconciliationTransactions.has(transaction)) return;
        trackChange('update', primKey, { ...obj, ...modifications });
      });

      // Hook into deleting
      const deletingHook = table.hook('deleting', (primKey, _obj, transaction) => {
        if (reconciliationTransactions.has(transaction)) return;
        trackChange('delete', primKey);
      });

      this.hooks.set(tableName, { creatingHook, updatingHook, deletingHook });
    });
  }

  stopTracking() {
    this.hooks.forEach((hooks) => {
      if (hooks.creatingHook) hooks.creatingHook.unsubscribe();
      if (hooks.updatingHook) hooks.updatingHook.unsubscribe();
      if (hooks.deletingHook) hooks.deletingHook.unsubscribe();
    });
    this.hooks.clear();
  }

  private trackChange(table: string, operation: Operation, key: any, obj?: any) {
    // Don't track changes to sync metadata tables
    if (['outbox', 'checkpoints', 'deadLetters'].includes(table)) {
      return;
    }

    // This runs inside the hook of the mutation being tracked, which means
    // it's still inside that mutation's IndexedDB transaction — one scoped
    // only to the table being written (e.g. 'posts'). Writing to 'outbox'
    // (a different table) on that same transaction throws NotFoundError,
    // since IndexedDB transactions can't touch stores outside their declared
    // scope. Deferring past the current task lets this write start its own
    // transaction instead of trying to join that one.
    queueMicrotask(() => {
      this.outboxManager.add(table, operation, key, obj).catch((error) => {
        console.error('Failed to track change:', error);
      });
    });
  }
}

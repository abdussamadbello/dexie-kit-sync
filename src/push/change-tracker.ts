import type Dexie from 'dexie';
import type { Operation } from '../core/types';
import { OutboxManager } from './outbox-manager';

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

      // Hook into creating
      const creatingHook = table.hook('creating', (primKey, obj) => {
        this.trackChange(tableName, 'create', primKey, obj);
      });

      // Hook into updating
      const updatingHook = table.hook('updating', (modifications, primKey, obj) => {
        this.trackChange(tableName, 'update', primKey, { ...obj, ...modifications });
      });

      // Hook into deleting
      const deletingHook = table.hook('deleting', (primKey) => {
        this.trackChange(tableName, 'delete', primKey);
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

    // Add to outbox asynchronously
    this.outboxManager.add(table, operation, key, obj).catch((error) => {
      console.error('Failed to track change:', error);
    });
  }
}

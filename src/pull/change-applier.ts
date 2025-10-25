import type Dexie from 'dexie';
import type { SyncContext, ConflictInfo } from '../core/types';
import { ConflictResolver } from '../conflict/resolver';
import { OutboxManager } from '../push/outbox-manager';

export class ChangeApplier {
  private outboxManager: OutboxManager;
  private conflictResolver?: ConflictResolver;

  constructor(
    private db: Dexie,
    private context: SyncContext
  ) {
    this.outboxManager = new OutboxManager(db);

    if (context.config.conflicts) {
      this.conflictResolver = new ConflictResolver(context.config.conflicts, context);
    }
  }

  async applyChanges(table: string, items: any[]): Promise<{ applied: number; conflicts: number }> {
    let applied = 0;
    let conflicts = 0;

    const dbTable = this.db.table(table);

    for (const item of items) {
      try {
        // Check if there's a pending local change
        const pendingChanges = await this.outboxManager.getAll(table);
        const hasPendingChange = pendingChanges.some((change) => change.key === item.id);

        if (hasPendingChange) {
          // Potential conflict
          const local = await dbTable.get(item.id);
          
          if (local && this.conflictResolver?.detectConflict(local, item)) {
            conflicts++;
            const resolved = await this.resolveConflict(table, item.id, local, item);
            await dbTable.put(resolved);
          } else {
            // No real conflict, apply server version
            await dbTable.put(item);
          }
        } else {
          // No local changes, just apply
          await dbTable.put(item);
        }

        applied++;
      } catch (error) {
        console.error(`Failed to apply change for ${table}:`, error);
      }
    }

    return { applied, conflicts };
  }

  private async resolveConflict(
    table: string,
    key: string | number,
    local: any,
    remote: any
  ): Promise<any> {
    const conflict: ConflictInfo = {
      table,
      key,
      local,
      remote,
      localTimestamp: local.updatedAt ? new Date(local.updatedAt).getTime() : undefined,
      remoteTimestamp: remote.updatedAt ? new Date(remote.updatedAt).getTime() : undefined,
      localVersion: local.version,
      remoteVersion: remote.version,
    };

    if (this.conflictResolver) {
      return await this.conflictResolver.resolve(conflict);
    }

    // Default to server wins
    return remote;
  }
}

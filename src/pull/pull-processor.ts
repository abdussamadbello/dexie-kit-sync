import type Dexie from 'dexie';
import type { PullResult, SyncContext } from '../core/types';
import { RestAdapter } from '../adapters/rest-adapter';
import { CheckpointManager } from './checkpoint-manager';
import { ChangeApplier } from './change-applier';

export class PullProcessor {
  private checkpointManager: CheckpointManager;
  private changeApplier: ChangeApplier;

  constructor(
    private db: Dexie,
    private adapter: RestAdapter,
    private context: SyncContext
  ) {
    this.checkpointManager = new CheckpointManager(db);
    this.changeApplier = new ChangeApplier(db, context);
  }

  async pull(table?: string): Promise<PullResult> {
    const result: PullResult = {
      success: true,
      pulled: 0,
      applied: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      const tables = table
        ? [table]
        : Object.keys(this.context.config.routes).filter(
            (t) => this.context.config.routes[t].pull
          );

      for (const tableName of tables) {
        try {
          const items = await this.adapter.pull(tableName);
          result.pulled += items.length;

          const { applied, conflicts } = await this.changeApplier.applyChanges(tableName, items);
          result.applied += applied;
          result.conflicts += conflicts;
        } catch (error: any) {
          result.errors.push(error);
          console.error(`Failed to pull ${tableName}:`, error);
        }
      }

      result.success = result.errors.length === 0;
    } catch (error) {
      result.success = false;
      console.error('Pull failed:', error);
    }

    return result;
  }
}

import type Dexie from 'dexie';
import type { Checkpoint } from '../core/types';

export class CheckpointManager {
  private checkpointsTable: Dexie.Table<Checkpoint, string>;

  constructor(db: Dexie) {
    this.checkpointsTable = db.table('checkpoints');
  }

  async get(scope: string): Promise<string | number | null> {
    const checkpoint = await this.checkpointsTable.get(scope);
    return checkpoint ? checkpoint.revision : null;
  }

  async set(scope: string, revision: string | number): Promise<void> {
    await this.checkpointsTable.put({
      scope,
      revision,
      updatedAt: Date.now(),
    });
  }

  async delete(scope: string): Promise<void> {
    await this.checkpointsTable.delete(scope);
  }

  async clear(): Promise<void> {
    await this.checkpointsTable.clear();
  }

  async getAll(): Promise<Checkpoint[]> {
    return this.checkpointsTable.toArray();
  }
}

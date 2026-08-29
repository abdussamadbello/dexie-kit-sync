import type Dexie from 'dexie';
import type { OutboxItem, Operation } from '../core/types';

export class OutboxManager {
  private outboxTable: Dexie.Table<OutboxItem, number>;

  constructor(db: Dexie) {
    this.outboxTable = db.table('outbox');
  }

  async add(table: string, operation: Operation, key: string | number, obj?: any): Promise<void> {
    await this.outboxTable.add({
      table,
      operation,
      key,
      obj,
      attempt: 0,
      createdAt: Date.now(),
    });
  }

  async getAll(table?: string): Promise<OutboxItem[]> {
    const query = this.outboxTable.orderBy('createdAt');

    if (table) {
      return query.filter((item) => item.table === table).toArray();
    }

    return query.toArray();
  }

  async getPending(): Promise<OutboxItem[]> {
    const now = Date.now();
    return this.outboxTable
      .orderBy('createdAt')
      .filter((item) => !item.nextRetryAt || item.nextRetryAt <= now)
      .toArray();
  }

  async remove(id: number): Promise<void> {
    await this.outboxTable.delete(id);
  }

  /**
   * If this record's create is still sitting unsynced in the outbox, the
   * server never knew it existed — drop the whole queued history for it
   * (the create and any updates) instead of pushing a delete. Returns true
   * if it cancelled the record's history this way (caller should not queue
   * the delete itself); false if a create already went out (there's a real
   * server-side record to delete, so the delete must still be tracked).
   */
  async cancelIfNeverSynced(table: string, key: string | number): Promise<boolean> {
    const pending = await this.outboxTable
      .filter((item) => item.table === table && item.key === key)
      .toArray();

    const hasUnsyncedCreate = pending.some((item) => item.operation === 'create');
    if (!hasUnsyncedCreate) {
      return false;
    }

    await this.outboxTable.bulkDelete(pending.map((item) => item.id!));
    return true;
  }

  async updateRetry(id: number, error: string, nextRetryAt: number): Promise<void> {
    const item = await this.outboxTable.get(id);
    if (item) {
      await this.outboxTable.update(id, {
        attempt: item.attempt + 1,
        lastError: error,
        nextRetryAt,
      });
    }
  }

  async getDepth(table?: string): Promise<number> {
    if (table) {
      return this.outboxTable.filter((item) => item.table === table).count();
    }
    return this.outboxTable.count();
  }

  async getOldestItem(): Promise<OutboxItem | undefined> {
    return this.outboxTable.orderBy('createdAt').first();
  }

  async clear(table?: string): Promise<void> {
    if (table) {
      const items = await this.outboxTable.filter((item) => item.table === table).toArray();
      await this.outboxTable.bulkDelete(items.map((item) => item.id!));
    } else {
      await this.outboxTable.clear();
    }
  }
}

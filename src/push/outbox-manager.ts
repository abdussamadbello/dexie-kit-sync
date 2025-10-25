import type Dexie from 'dexie';
import type { OutboxItem, Operation } from '../core/types';

export class OutboxManager {
  private outboxTable: Dexie.Table<OutboxItem, number>;

  constructor(private db: Dexie) {
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
    let query = this.outboxTable.orderBy('createdAt');

    if (table) {
      return query.filter((item) => item.table === table).toArray();
    }

    return query.toArray();
  }

  async getPending(): Promise<OutboxItem[]> {
    const now = Date.now();
    return this.outboxTable
      .filter((item) => !item.nextRetryAt || item.nextRetryAt <= now)
      .toArray();
  }

  async remove(id: number): Promise<void> {
    await this.outboxTable.delete(id);
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

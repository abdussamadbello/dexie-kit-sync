import type Dexie from 'dexie';
import type { OutboxItem, PushResult, SyncContext, DeadLetterItem } from '../core/types';
import { OutboxManager } from './outbox-manager';
import { RestAdapter } from '../adapters/rest-adapter';
import { calculateBackoff } from '../utils/backoff';
import { reconciliationTransactions } from './change-tracker';

export class PushProcessor {
  private outboxManager: OutboxManager;
  private deadLettersTable: Dexie.Table<DeadLetterItem, number>;

  constructor(
    private db: Dexie,
    private adapter: RestAdapter,
    private context: SyncContext
  ) {
    this.outboxManager = new OutboxManager(db);
    this.deadLettersTable = db.table('deadLetters');
  }

  async push(table?: string): Promise<PushResult> {
    const result: PushResult = {
      success: true,
      pushed: 0,
      failed: 0,
      errors: [],
    };

    try {
      const items = await this.outboxManager.getPending();
      const filteredItems = items.filter(
        (item) => (!table || item.table === table) && !this.context.isTablePaused(item.table)
      );

      const batchSize = this.context.config.sync?.push?.batchSize || 10;
      const concurrency = this.context.config.sync?.push?.concurrency || 3;

      // Changes to the same record must be delivered in the order they were
      // made (e.g. create must land before a later update to the same key),
      // so each record's queue is processed sequentially. Different records'
      // queues run concurrently for throughput.
      const queues = this.groupByRecord(filteredItems);

      for (let i = 0; i < queues.length; i += batchSize) {
        const batch = queues.slice(i, i + batchSize);
        await this.runWithConcurrency(batch, concurrency, (queue) =>
          this.pushQueue(queue, result)
        );
      }

      result.success = result.failed === 0;
    } catch (error) {
      result.success = false;
      console.error('Push failed:', error);
    }

    return result;
  }

  private groupByRecord(items: OutboxItem[]): OutboxItem[][] {
    const queues = new Map<string, OutboxItem[]>();

    for (const item of items) {
      const groupKey = `${item.table}:${item.key}`;
      const queue = queues.get(groupKey);
      if (queue) {
        queue.push(item);
      } else {
        queues.set(groupKey, [item]);
      }
    }

    return Array.from(queues.values());
  }

  private async runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T) => Promise<void>
  ): Promise<void> {
    let index = 0;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));

    const runners = Array.from({ length: workerCount }, async () => {
      while (index < items.length) {
        const current = items[index++];
        await worker(current);
      }
    });

    await Promise.all(runners);
  }

  private async pushQueue(queue: OutboxItem[], result: PushResult): Promise<void> {
    for (const item of queue) {
      // Stop at the first failure in this record's queue: later operations
      // (e.g. an update) depend on earlier ones (e.g. the create) having
      // actually landed, so they'll be retried in order on the next sync.
      const succeeded = await this.pushItem(item, result);
      if (!succeeded) {
        break;
      }
    }
  }

  private async pushItem(item: OutboxItem, result: PushResult): Promise<boolean> {
    try {
      const response = await this.adapter.pushItem(item);

      if (item.operation !== 'delete') {
        await this.applyServerResponse(item, response);
      }

      await this.outboxManager.remove(item.id!);
      result.pushed++;
      return true;
    } catch (error: any) {
      result.failed++;
      result.errors.push(error);
      this.context.metrics?.recordError(error?.type || 'unknown');

      const maxRetries = this.getMaxRetries(error.type);

      if (item.attempt >= maxRetries || !error.retryable) {
        // Move to dead letter queue
        await this.moveToDeadLetters(item, error);
      } else {
        // Schedule retry
        this.context.metrics?.recordFailedRetry();
        const retryDelay = error.retryAfter ?? this.getRetryDelay(item.attempt);
        const nextRetryAt = Date.now() + retryDelay;
        await this.outboxManager.updateRetry(item.id!, error.message, nextRetryAt);
      }

      return false;
    }
  }

  /**
   * Merge server-computed fields (e.g. updatedAt, version) back onto the
   * local record. The primary-key field is stripped from the merge first:
   * unlike a plain object spread, Dexie's `update()` treats a *changed*
   * primary-key value as "delete the old record and insert a new one under
   * the new key" — so passing through a server-assigned id that differs
   * from the local one would silently delete-and-recreate the record
   * instead of updating it. This cannot remap a server-assigned id onto a
   * locally auto-incremented key — routes should have the server
   * accept/echo the client-generated id when the two need to match.
   */
  private async applyServerResponse(item: OutboxItem, response: any): Promise<void> {
    if (!response || typeof response !== 'object') {
      return;
    }

    try {
      const table = this.db.table(item.table);
      const keyPath = table.schema.primKey.keyPath;
      const keyFields = Array.isArray(keyPath) ? keyPath : keyPath ? [keyPath] : [];
      const fields = { ...response };
      keyFields.forEach((field) => delete fields[field]);

      if (Object.keys(fields).length === 0) {
        return;
      }

      // Tag this transaction so change tracking doesn't queue our own
      // reconciliation write as a new outbox item (which would just get
      // pushed straight back to the server, forever).
      await this.db.transaction('rw', table, async (trans) => {
        reconciliationTransactions.add(trans);
        await table.update(item.key, fields);
      });
    } catch (error) {
      console.error(`Failed to apply server response for ${item.table}:${item.key}:`, error);
    }
  }

  private async moveToDeadLetters(item: OutboxItem, error: any): Promise<void> {
    await this.deadLettersTable.add({
      table: item.table,
      operation: item.operation,
      key: item.key,
      obj: item.obj,
      error: error.message || String(error),
      errorType: error.type || 'unknown',
      failedAt: Date.now(),
      originalAttempts: item.attempt,
    });

    this.context.metrics?.recordDeadLetter();
    await this.outboxManager.remove(item.id!);
  }

  private getMaxRetries(_errorType: string): number {
    const errorConfig = this.context.config.errors;
    if (!errorConfig?.maxRetries) {
      return 5; // Default
    }

    return errorConfig.maxRetries;
  }

  private getRetryDelay(attempt: number): number {
    const errorConfig = this.context.config.errors;
    if (errorConfig?.retryDelay) {
      return errorConfig.retryDelay(attempt);
    }

    return calculateBackoff(attempt);
  }
}

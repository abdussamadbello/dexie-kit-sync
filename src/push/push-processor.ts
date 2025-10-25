import type Dexie from 'dexie';
import type { PushResult, SyncContext, DeadLetterItem, ErrorConfig } from '../core/types';
import { OutboxManager } from './outbox-manager';
import { RestAdapter } from '../adapters/rest-adapter';
import { calculateBackoff } from '../utils/backoff';

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
      const filteredItems = table ? items.filter((item) => item.table === table) : items;

      const batchSize = this.context.config.sync?.push?.batchSize || 10;
      const concurrency = this.context.config.sync?.push?.concurrency || 3;

      // Process in batches with concurrency
      for (let i = 0; i < filteredItems.length; i += batchSize) {
        const batch = filteredItems.slice(i, i + batchSize);
        const promises: Promise<void>[] = [];

        for (const item of batch) {
          promises.push(this.pushItem(item, result));

          // Limit concurrency
          if (promises.length >= concurrency) {
            await Promise.allSettled(promises.splice(0, concurrency));
          }
        }

        // Wait for remaining promises
        if (promises.length > 0) {
          await Promise.allSettled(promises);
        }
      }

      result.success = result.failed === 0;
    } catch (error) {
      result.success = false;
      console.error('Push failed:', error);
    }

    return result;
  }

  private async pushItem(item: OutboxItem, result: PushResult): Promise<void> {
    try {
      await this.adapter.pushItem(item);
      await this.outboxManager.remove(item.id!);
      result.pushed++;
    } catch (error: any) {
      result.failed++;
      result.errors.push(error);

      const maxRetries = this.getMaxRetries(error.type);

      if (item.attempt >= maxRetries || !error.retryable) {
        // Move to dead letter queue
        await this.moveToDeadLetters(item, error);
      } else {
        // Schedule retry
        const retryDelay = this.getRetryDelay(item.attempt);
        const nextRetryAt = Date.now() + retryDelay;
        await this.outboxManager.updateRetry(item.id!, error.message, nextRetryAt);
      }
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

    await this.outboxManager.remove(item.id!);
  }

  private getMaxRetries(errorType: string): number {
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

import type { SyncMetrics } from '../core/types';

export class MetricsCollector {
  private metrics: SyncMetrics = {
    queue: {
      depth: 0,
      oldestItemAge: 0,
      avgProcessingTime: 0,
    },
    sync: {
      lastSyncStarted: 0,
      lastSyncCompleted: 0,
      lastSyncDuration: 0,
      syncCount: 0,
      pushCount: 0,
      pullCount: 0,
    },
    errors: {
      total: 0,
      byType: {},
      failedRetries: 0,
      deadLetterCount: 0,
    },
    network: {
      requestCount: 0,
      bytesUploaded: 0,
      bytesDownloaded: 0,
      avgLatency: 0,
    },
    data: {
      totalRecords: 0,
      byTable: {},
    },
  };

  private latencies: number[] = [];

  recordSyncStart() {
    this.metrics.sync.lastSyncStarted = Date.now();
  }

  recordSyncComplete() {
    const now = Date.now();
    this.metrics.sync.lastSyncCompleted = now;
    this.metrics.sync.lastSyncDuration = now - this.metrics.sync.lastSyncStarted;
    this.metrics.sync.syncCount++;
  }

  recordPush() {
    this.metrics.sync.pushCount++;
  }

  recordPull() {
    this.metrics.sync.pullCount++;
  }

  recordError(type: string) {
    this.metrics.errors.total++;
    this.metrics.errors.byType[type] = (this.metrics.errors.byType[type] || 0) + 1;
  }

  recordFailedRetry() {
    this.metrics.errors.failedRetries++;
  }

  recordDeadLetter() {
    this.metrics.errors.deadLetterCount++;
  }

  recordRequest(bytesUploaded: number, bytesDownloaded: number, latency: number) {
    this.metrics.network.requestCount++;
    this.metrics.network.bytesUploaded += bytesUploaded;
    this.metrics.network.bytesDownloaded += bytesDownloaded;

    this.latencies.push(latency);
    if (this.latencies.length > 100) {
      this.latencies.shift();
    }
    this.metrics.network.avgLatency =
      this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;
  }

  updateQueueDepth(depth: number) {
    this.metrics.queue.depth = depth;
  }

  updateOldestItemAge(age: number) {
    this.metrics.queue.oldestItemAge = age;
  }

  updateTableRecords(table: string, count: number) {
    this.metrics.data.byTable[table] = count;
    this.metrics.data.totalRecords = Object.values(this.metrics.data.byTable).reduce(
      (sum, c) => sum + c,
      0
    );
  }

  getMetrics(): SyncMetrics {
    return { ...this.metrics };
  }

  reset() {
    this.metrics = {
      queue: {
        depth: 0,
        oldestItemAge: 0,
        avgProcessingTime: 0,
      },
      sync: {
        lastSyncStarted: 0,
        lastSyncCompleted: 0,
        lastSyncDuration: 0,
        syncCount: 0,
        pushCount: 0,
        pullCount: 0,
      },
      errors: {
        total: 0,
        byType: {},
        failedRetries: 0,
        deadLetterCount: 0,
      },
      network: {
        requestCount: 0,
        bytesUploaded: 0,
        bytesDownloaded: 0,
        avgLatency: 0,
      },
      data: {
        totalRecords: 0,
        byTable: {},
      },
    };
    this.latencies = [];
  }
}

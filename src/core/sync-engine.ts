import type Dexie from 'dexie';
import type {
  SyncConfig,
  SyncEngine as ISyncEngine,
  SyncResult,
  PushResult,
  PullResult,
  SyncStatus,
  SyncMetrics,
  HealthCheckResult,
  DeadLetterItem,
  SyncEvent,
  EventHandler,
} from './types';
import { SyncContext } from './sync-context';
import { PushProcessor } from '../push/push-processor';
import { PullProcessor } from '../pull/pull-processor';
import { ChangeTracker } from '../push/change-tracker';
import { RestAdapter } from '../adapters/rest-adapter';
import { LeaderElection } from '../utils/leader-election';
import { MetricsCollector } from '../utils/metrics-collector';
import { OutboxManager } from '../push/outbox-manager';

export class SyncEngine implements ISyncEngine {
  private context: SyncContext;
  private pushProcessor: PushProcessor;
  private pullProcessor: PullProcessor;
  private changeTracker: ChangeTracker;
  private leaderElection: LeaderElection;
  private metricsCollector: MetricsCollector;
  private outboxManager: OutboxManager;

  private isRunning = false;
  private isPausedFlag = false;
  private isSyncingFlag = false;
  private syncInterval?: number;
  private pausedTables: Set<string> = new Set();

  constructor(
    private db: Dexie,
    private config: SyncConfig
  ) {
    this.context = new SyncContext(db, config);
    
    const adapter = new RestAdapter(config.baseUrl, config.routes, this.context);
    this.pushProcessor = new PushProcessor(db, adapter, this.context);
    this.pullProcessor = new PullProcessor(db, adapter, this.context);
    
    this.changeTracker = new ChangeTracker(db);
    this.leaderElection = new LeaderElection();
    this.metricsCollector = new MetricsCollector();
    this.outboxManager = new OutboxManager(db);

    this.setupEventListeners();
  }

  private setupEventListeners() {
    // Listen for online/offline events
    if (this.config.sync?.onOnline) {
      this.context.on('online', () => {
        if (this.isRunning && this.leaderElection.isLeader()) {
          this.sync().catch(console.error);
        }
      });
    }

    // Listen for visibility changes
    if (this.config.sync?.onVisibilityChange && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.isRunning && this.leaderElection.isLeader()) {
          this.sync().catch(console.error);
        }
      });
    }

    // Leadership changes
    this.leaderElection.onLeadershipChange((isLeader) => {
      if (isLeader && this.isRunning) {
        this.startSyncInterval();
      } else {
        this.stopSyncInterval();
      }
    });
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      return;
    }

    // Elect leader
    await this.leaderElection.electLeader();

    // Get synced tables
    const tables = this.getSyncedTables();

    // Start tracking changes
    this.changeTracker.startTracking(tables);

    // Start sync interval if we're the leader
    if (this.leaderElection.isLeader()) {
      this.startSyncInterval();
    }

    this.isRunning = true;

    // Initial sync
    if (this.leaderElection.isLeader()) {
      await this.sync();
    }
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    this.stopSyncInterval();
    this.changeTracker.stopTracking();
    this.leaderElection.destroy();
  }

  async pause(): Promise<void> {
    this.isPausedFlag = true;
    this.stopSyncInterval();
  }

  async resume(): Promise<void> {
    this.isPausedFlag = false;
    if (this.isRunning && this.leaderElection.isLeader()) {
      this.startSyncInterval();
      await this.sync();
    }
  }

  async sync(): Promise<SyncResult> {
    if (!this.context.isOnline()) {
      throw new Error('Cannot sync while offline');
    }

    if (this.isPausedFlag) {
      throw new Error('Sync is paused');
    }

    if (this.isSyncingFlag) {
      throw new Error('Sync already in progress');
    }

    this.isSyncingFlag = true;
    this.context.emit('sync-start');
    this.metricsCollector.recordSyncStart();

    const startTime = Date.now();

    try {
      // Push first
      this.context.emit('push-start');
      const pushResult = await this.pushProcessor.push();
      this.context.emit('push-complete', pushResult);
      this.metricsCollector.recordPush();

      if (!pushResult.success) {
        this.context.emit('push-error', pushResult.errors);
      }

      // Then pull
      this.context.emit('pull-start');
      const pullResult = await this.pullProcessor.pull();
      this.context.emit('pull-complete', pullResult);
      this.metricsCollector.recordPull();

      if (!pullResult.success) {
        this.context.emit('pull-error', pullResult.errors);
      }

      const result: SyncResult = {
        success: pushResult.success && pullResult.success,
        push: pushResult,
        pull: pullResult,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };

      this.context.emit('sync-complete', result);
      this.metricsCollector.recordSyncComplete();

      return result;
    } catch (error) {
      this.context.emit('sync-error', error);
      throw error;
    } finally {
      this.isSyncingFlag = false;
    }
  }

  async push(table?: string): Promise<PushResult> {
    return this.pushProcessor.push(table);
  }

  async pull(table?: string): Promise<PullResult> {
    return this.pullProcessor.pull(table);
  }

  async syncTable(table: string): Promise<SyncResult> {
    const pushResult = await this.push(table);
    const pullResult = await this.pull(table);

    return {
      success: pushResult.success && pullResult.success,
      push: pushResult,
      pull: pullResult,
      duration: 0,
      timestamp: Date.now(),
    };
  }

  getStatus(): SyncStatus {
    return {
      isRunning: this.isRunning,
      isPaused: this.isPausedFlag,
      isOnline: this.context.isOnline(),
      isLeader: this.leaderElection.isLeader(),
      lastSync: this.metricsCollector.getMetrics().sync.lastSyncCompleted,
      queueDepth: this.metricsCollector.getMetrics().queue.depth,
      errors: this.metricsCollector.getMetrics().errors.total,
    };
  }

  isOnline(): boolean {
    return this.context.isOnline();
  }

  isSyncing(): boolean {
    return this.isSyncingFlag;
  }

  isLeader(): boolean {
    return this.leaderElection.isLeader();
  }

  async getQueueDepth(table?: string): Promise<number> {
    return this.outboxManager.getDepth(table);
  }

  async getMetrics(): Promise<SyncMetrics> {
    const metrics = this.metricsCollector.getMetrics();
    
    // Update queue metrics
    const depth = await this.outboxManager.getDepth();
    this.metricsCollector.updateQueueDepth(depth);

    const oldest = await this.outboxManager.getOldestItem();
    if (oldest) {
      const age = Date.now() - oldest.createdAt;
      this.metricsCollector.updateOldestItemAge(age);
    }

    return this.metricsCollector.getMetrics();
  }

  async isStale(table: string, key: string | number): Promise<boolean> {
    // TODO: Implement staleness tracking
    return false;
  }

  async pauseTable(table: string): Promise<void> {
    this.pausedTables.add(table);
  }

  async resumeTable(table: string): Promise<void> {
    this.pausedTables.delete(table);
  }

  on(event: SyncEvent, handler: EventHandler): () => void {
    return this.context.on(event, handler);
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const metrics = await this.getMetrics();
    const issues: HealthCheckResult['issues'] = [];

    // Check queue depth
    if (metrics.queue.depth > 100) {
      issues.push({
        severity: 'warning',
        message: `High queue depth: ${metrics.queue.depth} items`,
        code: 'HIGH_QUEUE_DEPTH',
      });
    }

    // Check last sync time
    const timeSinceLastSync = Date.now() - metrics.sync.lastSyncCompleted;
    if (timeSinceLastSync > 300000) {
      // 5 minutes
      issues.push({
        severity: 'warning',
        message: `No sync in ${Math.round(timeSinceLastSync / 60000)} minutes`,
        code: 'STALE_SYNC',
      });
    }

    // Check error rate
    const errorRate = metrics.errors.total / (metrics.sync.syncCount || 1);
    if (errorRate > 0.1) {
      issues.push({
        severity: 'error',
        message: `High error rate: ${(errorRate * 100).toFixed(1)}%`,
        code: 'HIGH_ERROR_RATE',
      });
    }

    return {
      healthy: issues.filter((i) => i.severity === 'error').length === 0,
      issues,
      metrics: {
        queueDepth: metrics.queue.depth,
        lastSync: metrics.sync.lastSyncCompleted,
        errorRate,
      },
    };
  }

  async getDeadLetters(table?: string): Promise<DeadLetterItem[]> {
    const deadLettersTable = this.db.table<DeadLetterItem>('deadLetters');
    if (table) {
      return deadLettersTable.filter((item) => item.table === table).toArray();
    }
    return deadLettersTable.toArray();
  }

  async retryDeadLetter(id: number): Promise<void> {
    const deadLettersTable = this.db.table<DeadLetterItem>('deadLetters');
    const item = await deadLettersTable.get(id);

    if (!item) {
      throw new Error(`Dead letter ${id} not found`);
    }

    // Move back to outbox
    await this.outboxManager.add(item.table, item.operation, item.key, item.obj);

    // Remove from dead letters
    await deadLettersTable.delete(id);
  }

  private startSyncInterval() {
    this.stopSyncInterval();

    const interval = this.config.sync?.interval;
    if (interval && interval > 0) {
      this.syncInterval = window.setInterval(() => {
        if (!this.isPausedFlag && this.context.isOnline()) {
          this.sync().catch(console.error);
        }
      }, interval);
    }
  }

  private stopSyncInterval() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
  }

  private getSyncedTables(): string[] {
    const allTables = Object.keys(this.config.routes);
    
    if (this.config.tables) {
      return this.config.tables;
    }

    if (this.config.excludeTables) {
      return allTables.filter((t) => !this.config.excludeTables!.includes(t));
    }

    return allTables;
  }
}

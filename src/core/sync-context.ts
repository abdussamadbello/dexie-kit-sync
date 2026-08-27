import type Dexie from 'dexie';
import type { SyncConfig, SyncContext as ISyncContext, SyncEvent, EventHandler } from './types';
import { MetricsCollector } from '../utils/metrics-collector';

export class SyncContext implements ISyncContext {
  private eventHandlers: Map<SyncEvent, Set<EventHandler>> = new Map();
  private onlineStatus = true;
  private pausedTables: Set<string> = new Set();
  public readonly metrics = new MetricsCollector();

  constructor(
    public db: Dexie,
    public config: SyncConfig
  ) {
    this.setupOnlineListener();
  }

  private setupOnlineListener() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        this.onlineStatus = true;
        this.emit('online');
      });

      window.addEventListener('offline', () => {
        this.onlineStatus = false;
        this.emit('offline');
      });

      this.onlineStatus = navigator.onLine;
    }
  }

  async getCheckpoint(scope: string): Promise<string | number | null> {
    const checkpointsTable = this.db.table('checkpoints');
    const checkpoint = await checkpointsTable.get(scope);
    return checkpoint ? checkpoint.revision : null;
  }

  async setCheckpoint(scope: string, revision: string | number): Promise<void> {
    const checkpointsTable = this.db.table('checkpoints');
    await checkpointsTable.put({
      scope,
      revision,
      updatedAt: Date.now(),
    });
  }

  isOnline(): boolean {
    return this.onlineStatus;
  }

  isTablePaused(table: string): boolean {
    return this.pausedTables.has(table);
  }

  setTablePaused(table: string, paused: boolean): void {
    if (paused) {
      this.pausedTables.add(table);
    } else {
      this.pausedTables.delete(table);
    }
  }

  emit(event: SyncEvent, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error in event handler for ${event}:`, error);
        }
      });
    }
  }

  on(event: SyncEvent, handler: EventHandler): () => void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }

    this.eventHandlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      const handlers = this.eventHandlers.get(event);
      if (handlers) {
        handlers.delete(handler);
      }
    };
  }
}

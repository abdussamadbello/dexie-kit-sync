import type Dexie from 'dexie';

// ===== HTTP Types =====

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// ===== Outbox and Queue Types =====

export type Operation = 'create' | 'update' | 'delete';

export interface OutboxItem {
  id?: number;
  table: string;
  operation: Operation;
  key: string | number;
  obj?: any;
  attempt: number;
  createdAt: number;
  lastError?: string;
  nextRetryAt?: number;
}

export interface Checkpoint {
  scope: string;
  revision: string | number;
  updatedAt: number;
}

export interface DeadLetterItem {
  id?: number;
  table: string;
  operation: Operation;
  key: string | number;
  obj?: any;
  error: string;
  errorType: string;
  failedAt: number;
  originalAttempts: number;
}

// ===== Error Types =====

export interface SyncError {
  type: 'network' | 'auth' | 'validation' | 'conflict' | 'quota' | 'server' | 'client';
  code: string;
  retryable: boolean;
  message: string;
  status?: number;
  retryAfter?: number;
  details?: any;
}

export interface AuthError extends SyncError {
  type: 'auth';
  requiresUserAction?: boolean;
}

export interface ConflictError extends SyncError {
  type: 'conflict';
  localValue: unknown;
  remoteValue: unknown;
  resolution: 'manual' | 'auto';
}

// ===== Conflict Resolution Types =====

export type ConflictPolicy = 'server-wins' | 'client-wins' | 'lww' | 'custom';

export interface ConflictInfo {
  table: string;
  key: string | number;
  local: any;
  remote: any;
  localTimestamp?: number;
  remoteTimestamp?: number;
  localVersion?: number;
  remoteVersion?: number;
}

// ===== Route Configuration Types =====

export interface OperationConfig {
  method: HttpMethod;
  url: string | ((item: any) => string);
  body?: (item: any) => any;
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
}

export interface PaginationConfig {
  style: 'cursor' | 'offset' | 'page';
  extractCursor?: (response: any) => string;
  hasMore: (response: any) => boolean;
}

export interface PushRouteConfig {
  create?: OperationConfig;
  update?: OperationConfig;
  delete?: OperationConfig;
  url?: string;
  method?: HttpMethod;
  batch?: boolean;
  body?: (changes: OutboxItem[], ctx: SyncContext) => any;
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  rateLimit?: RateLimitConfig;
}

export interface PullRouteConfig {
  method: HttpMethod;
  url: string;
  query?: (ctx: SyncContext) => Promise<Record<string, any>> | Record<string, any>;
  mapResponse?: (response: any) => any[];
  pagination?: PaginationConfig;
  onComplete?: (response: any, ctx: SyncContext) => Promise<void> | void;
}

export interface RouteConfiguration {
  [tableName: string]: {
    push?: PushRouteConfig;
    pull?: PullRouteConfig;
  };
}

// ===== Rate Limiting Types =====

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

// ===== Sync Configuration Types =====

export interface AuthConfig {
  getHeaders: () => Promise<Record<string, string>> | Record<string, string>;
  onAuthError?: (error: AuthError) => Promise<void> | void;
  validateAuth?: () => Promise<boolean> | boolean;
  maxAuthRetries?: number;
}

export interface SyncBehaviorConfig {
  interval?: number;
  onOnline?: boolean;
  onVisibilityChange?: boolean;
  push?: {
    batchSize?: number;
    concurrency?: number;
    debounce?: number;
  };
  pull?: {
    pageSize?: number;
    maxPages?: number;
    pageDelay?: number;
  };
}

export interface ConflictConfig {
  policy: ConflictPolicy;
  onConflict?: (conflict: ConflictInfo) => Promise<any> | any;
}

export interface ErrorConfig {
  maxRetries?: number;
  retryDelay?: (attempt: number) => number;
  onError?: (error: SyncError, context: ErrorContext) => void;
}

export interface StalenessConfig {
  ttl?: {
    default: number;
    [table: string]: number;
  };
  staleWhileRevalidate?: boolean;
  onStale?: (table: string, count: number) => void;
}

export interface ObservabilityConfig {
  enabled?: boolean;
  metricsInterval?: number;
  onMetrics?: (metrics: SyncMetrics) => void;
  enableTracing?: boolean;
  enablePerformanceMarks?: boolean;
}

export interface SyncConfig {
  baseUrl: string;
  routes: RouteConfiguration;
  auth: AuthConfig;
  sync?: SyncBehaviorConfig;
  conflicts?: ConflictConfig;
  errors?: ErrorConfig;
  staleness?: StalenessConfig;
  observability?: ObservabilityConfig;
  tables?: string[];
  excludeTables?: string[];
}

// ===== Context Types =====

export interface ErrorContext {
  table: string;
  operation: Operation;
  attempt: number;
  item?: any;
}

export interface SyncContext {
  db: Dexie;
  config: SyncConfig;
  getCheckpoint: (scope: string) => Promise<string | number | null>;
  setCheckpoint: (scope: string, revision: string | number) => Promise<void>;
  isOnline: () => boolean;
  emit: (event: SyncEvent, data?: any) => void;
}

// ===== Results Types =====

export interface PushResult {
  success: boolean;
  pushed: number;
  failed: number;
  errors: SyncError[];
}

export interface PullResult {
  success: boolean;
  pulled: number;
  applied: number;
  conflicts: number;
  errors: SyncError[];
}

export interface SyncResult {
  success: boolean;
  push: PushResult;
  pull: PullResult;
  duration: number;
  timestamp: number;
}

// ===== Status Types =====

export interface SyncStatus {
  isRunning: boolean;
  isPaused: boolean;
  isOnline: boolean;
  isLeader: boolean;
  lastSync?: number;
  queueDepth: number;
  errors: number;
}

// ===== Metrics Types =====

export interface SyncMetrics {
  queue: {
    depth: number;
    oldestItemAge: number;
    avgProcessingTime: number;
  };
  sync: {
    lastSyncStarted: number;
    lastSyncCompleted: number;
    lastSyncDuration: number;
    syncCount: number;
    pushCount: number;
    pullCount: number;
  };
  errors: {
    total: number;
    byType: Record<string, number>;
    failedRetries: number;
    deadLetterCount: number;
  };
  network: {
    requestCount: number;
    bytesUploaded: number;
    bytesDownloaded: number;
    avgLatency: number;
  };
  data: {
    totalRecords: number;
    byTable: Record<string, number>;
    diskUsage?: number;
  };
}

export interface HealthCheckResult {
  healthy: boolean;
  issues: Array<{
    severity: 'warning' | 'error';
    message: string;
    code: string;
  }>;
  metrics: {
    queueDepth: number;
    lastSync: number;
    errorRate: number;
  };
}

// ===== Event Types =====

export type SyncEvent =
  | 'sync-start'
  | 'sync-complete'
  | 'sync-error'
  | 'push-start'
  | 'push-complete'
  | 'push-error'
  | 'pull-start'
  | 'pull-complete'
  | 'pull-error'
  | 'conflict'
  | 'online'
  | 'offline'
  | 'stale'
  | 'metrics';

export type EventHandler = (data?: any) => void;

// ===== Sync Engine Interface =====

export interface SyncEngine {
  // Lifecycle
  start(): Promise<void>;
  stop(): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;

  // Manual sync triggers
  sync(): Promise<SyncResult>;
  push(table?: string): Promise<PushResult>;
  pull(table?: string): Promise<PullResult>;
  syncTable(table: string): Promise<SyncResult>;

  // Status queries
  getStatus(): SyncStatus;
  isOnline(): boolean;
  isSyncing(): boolean;
  isLeader(): boolean;
  getQueueDepth(table?: string): Promise<number>;
  getMetrics(): Promise<SyncMetrics>;
  isStale(table: string, key: string | number): Promise<boolean>;

  // Table control
  pauseTable(table: string): Promise<void>;
  resumeTable(table: string): Promise<void>;

  // Events
  on(event: SyncEvent, handler: EventHandler): () => void;

  // Advanced
  healthCheck(): Promise<HealthCheckResult>;
  getDeadLetters(table?: string): Promise<DeadLetterItem[]>;
  retryDeadLetter(id: number): Promise<void>;
}

import type {
  OutboxItem,
  SyncContext,
  RouteConfiguration,
  OperationConfig,
  RateLimitConfig,
} from '../core/types';
import { HttpClient } from './http-client';
import { RateLimiter } from '../utils/rate-limiter';

export class RestAdapter {
  private httpClient: HttpClient;
  private rateLimiters = new Map<string, RateLimiter>();

  constructor(
    baseUrl: string,
    private routes: RouteConfiguration,
    private context: SyncContext
  ) {
    this.httpClient = new HttpClient(baseUrl);
  }

  async pushItem(item: OutboxItem): Promise<any> {
    const tableRoute = this.routes[item.table]?.push;
    if (!tableRoute) {
      throw new Error(`No push route configured for table: ${item.table}`);
    }

    let config: OperationConfig | undefined;

    switch (item.operation) {
      case 'create':
        config = tableRoute.create;
        break;
      case 'update':
        config = tableRoute.update;
        break;
      case 'delete':
        config = tableRoute.delete;
        break;
    }

    if (!config) {
      throw new Error(`No ${item.operation} config for table: ${item.table}`);
    }

    if (tableRoute.rateLimit) {
      await this.getRateLimiter(item.table, tableRoute.rateLimit).throttle(item.table);
    }

    // Deletes never carry a payload (the record is already gone locally by the
    // time this runs), so fall back to a synthetic { key: item.key } object —
    // otherwise url/body callbacks written as `item => item.id` (per the README)
    // would crash on undefined.
    const payload = item.obj !== undefined ? item.obj : { id: item.key };
    const url = typeof config.url === 'function' ? config.url(payload) : config.url;
    const body = config.body ? config.body(payload) : payload;
    const headers = await this.getHeaders(config.headers);

    return this.httpClient.request({
      method: config.method,
      url,
      headers,
      body: config.method !== 'DELETE' ? body : undefined,
      onProgress: (uploaded, downloaded, latency) => {
        this.context.metrics?.recordRequest(uploaded, downloaded, latency);
      },
    });
  }

  async pull(table: string): Promise<any[]> {
    const tableRoute = this.routes[table]?.pull;
    if (!tableRoute) {
      throw new Error(`No pull route configured for table: ${table}`);
    }

    const query = tableRoute.query ? await tableRoute.query(this.context) : {};
    const queryString = new URLSearchParams(query as any).toString();
    const url = queryString ? `${tableRoute.url}?${queryString}` : tableRoute.url;

    const response = await this.httpClient.request({
      method: tableRoute.method,
      url,
      headers: await this.getHeaders(),
      onProgress: (uploaded, downloaded, latency) => {
        this.context.metrics?.recordRequest(uploaded, downloaded, latency);
      },
    });

    const data = tableRoute.mapResponse ? tableRoute.mapResponse(response) : response;

    // Call onComplete callback if provided
    if (tableRoute.onComplete) {
      await tableRoute.onComplete(response, this.context);
    }

    return Array.isArray(data) ? data : [];
  }

  private getRateLimiter(table: string, config: RateLimitConfig): RateLimiter {
    let limiter = this.rateLimiters.get(table);
    if (!limiter) {
      limiter = new RateLimiter(config);
      this.rateLimiters.set(table, limiter);
    }
    return limiter;
  }

  private async getHeaders(
    additionalHeaders?: () => Record<string, string> | Promise<Record<string, string>>
  ): Promise<Record<string, string>> {
    const authHeaders = await this.context.config.auth.getHeaders();
    const extra = additionalHeaders ? await additionalHeaders() : {};

    return {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...extra,
    };
  }
}

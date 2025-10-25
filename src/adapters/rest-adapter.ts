import type {
  OutboxItem,
  SyncContext,
  RouteConfiguration,
  OperationConfig,
} from '../core/types';
import { HttpClient } from './http-client';

export class RestAdapter {
  private httpClient: HttpClient;

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

    const url = typeof config.url === 'function' ? config.url(item.obj) : config.url;
    const body = config.body ? config.body(item.obj) : item.obj;
    const headers = await this.getHeaders(config.headers);

    return this.httpClient.request({
      method: config.method,
      url,
      headers,
      body: config.method !== 'DELETE' ? body : undefined,
      onProgress: (_uploaded, _downloaded, _latency) => {
        // Track metrics if needed
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
    });

    const data = tableRoute.mapResponse ? tableRoute.mapResponse(response) : response;

    // Call onComplete callback if provided
    if (tableRoute.onComplete) {
      await tableRoute.onComplete(response, this.context);
    }

    return Array.isArray(data) ? data : [];
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

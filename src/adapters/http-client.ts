import type { SyncError, ConflictError } from '../core/types';
import { calculateBackoff } from '../utils/backoff';

export interface HttpOptions {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: any;
  maxRetries?: number;
  onProgress?: (bytesUploaded: number, bytesDownloaded: number, latency: number) => void;
}

export class HttpClient {
  constructor(private baseUrl: string) {}

  async request<T = any>(options: HttpOptions): Promise<T> {
    const maxRetries = options.maxRetries ?? 3;
    let lastError: SyncError | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeRequest<T>(options, attempt);
        return result;
      } catch (error) {
        lastError = error as SyncError;

        // Don't retry non-retryable errors
        if (!lastError.retryable || attempt >= maxRetries) {
          throw lastError;
        }

        // Wait before retrying
        const delay = lastError.retryAfter ?? calculateBackoff(attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }

  private async executeRequest<T>(options: HttpOptions, _attempt: number): Promise<T> {
    const url = options.url.startsWith('http') ? options.url : `${this.baseUrl}${options.url}`;

    const startTime = Date.now();
    let response: Response;

    try {
      response = await fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      const networkError: SyncError = {
        type: 'network',
        code: 'FETCH_FAILED',
        retryable: true,
        message: error instanceof Error ? error.message : 'Network request failed',
      };
      throw networkError;
    }

    const latency = Date.now() - startTime;
    const bodyText = await response.text();
    const bytesDownloaded = new Blob([bodyText]).size;
    const bytesUploaded = options.body ? new Blob([JSON.stringify(options.body)]).size : 0;

    options.onProgress?.(bytesUploaded, bytesDownloaded, latency);

    // Handle non-OK responses
    if (!response.ok) {
      const error = this.createErrorFromResponse(response, bodyText);
      throw error;
    }

    // Parse response
    try {
      return bodyText ? JSON.parse(bodyText) : (null as T);
    } catch {
      return bodyText as any;
    }
  }

  private createErrorFromResponse(response: Response, bodyText: string): SyncError {
    const status = response.status;
    let errorData: any = {};

    try {
      errorData = JSON.parse(bodyText);
    } catch {
      errorData = { message: bodyText };
    }

    // Network/server errors (5xx)
    if (status >= 500) {
      return {
        type: 'server',
        code: 'INTERNAL_ERROR',
        retryable: true,
        message: errorData.message || 'Server error',
        status,
      };
    }

    // Auth errors (401, 403)
    if (status === 401 || status === 403) {
      return {
        type: 'auth',
        code: status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
        retryable: false,
        message: errorData.message || 'Authentication failed',
        status,
      };
    }

    // Conflict (409)
    if (status === 409) {
      return {
        type: 'conflict',
        code: 'VERSION_MISMATCH',
        retryable: false,
        message: errorData.message || 'Conflict detected',
        status,
        localValue: undefined,
        remoteValue: errorData.serverData || errorData,
        resolution: 'manual',
      } as ConflictError;
    }

    // Rate limit (429)
    if (status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '60') * 1000;
      return {
        type: 'quota',
        code: 'RATE_LIMIT',
        retryable: true,
        message: errorData.message || 'Rate limit exceeded',
        status,
        retryAfter,
      };
    }

    // Validation errors (400, 422)
    if (status === 400 || status === 422) {
      return {
        type: 'validation',
        code: 'INVALID_DATA',
        retryable: false,
        message: errorData.message || 'Validation failed',
        status,
        details: errorData.details || errorData,
      };
    }

    // Not found (404)
    if (status === 404) {
      return {
        type: 'client',
        code: 'NOT_FOUND',
        retryable: false,
        message: errorData.message || 'Resource not found',
        status,
      };
    }

    // Generic client error
    return {
      type: 'client',
      code: 'CLIENT_ERROR',
      retryable: false,
      message: errorData.message || 'Client error',
      status,
    };
  }
}

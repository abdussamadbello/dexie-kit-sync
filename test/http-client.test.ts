import { describe, it, expect, vi, afterEach } from 'vitest';
import { HttpClient, parseRetryAfterMs } from '../src/adapters/http-client';

describe('parseRetryAfterMs', () => {
  it('parses delay-seconds form', () => {
    expect(parseRetryAfterMs('120')).toBe(120000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('parses HTTP-date form instead of returning NaN', () => {
    const future = new Date(Date.now() + 30000);
    const ms = parseRetryAfterMs(future.toUTCString());
    // Allow slack for the time spent computing `future` vs. now inside the parser.
    expect(ms).toBeGreaterThan(25000);
    expect(ms).toBeLessThanOrEqual(30000);
  });

  it('falls back to a default when the header is missing or unparseable', () => {
    expect(parseRetryAfterMs(null)).toBe(60000);
    expect(parseRetryAfterMs('not-a-date')).toBe(60000);
  });
});

describe('HttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('respects a date-form Retry-After instead of retrying almost immediately', async () => {
    // toUTCString() truncates to whole seconds, so a short delay here could
    // round away to ~0. Use a delay large enough that the up-to-1s rounding
    // error can't hide a real regression (parsing as NaN retries after ~0ms).
    const retryAfterDate = new Date(Date.now() + 3000).toUTCString();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response('{"message":"slow down"}', {
          status: 429,
          headers: { 'Retry-After': retryAfterDate },
        })
      )
      .mockResolvedValueOnce(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new HttpClient('https://api.example.com');
    const start = Date.now();
    const result = await client.request({ method: 'GET', url: '/x' });
    const elapsed = Date.now() - start;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: true });
    expect(elapsed).toBeGreaterThanOrEqual(1900);
  }, 10000);
});

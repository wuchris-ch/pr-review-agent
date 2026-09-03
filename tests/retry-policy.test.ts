import { describe, expect, it } from 'vitest';
import { isRetryableHttpStatus, retryDelayMs } from '../src/agents/retry-policy.js';

describe('model request retry policy', () => {
  it('retries only transient HTTP failures', () => {
    expect(isRetryableHttpStatus(408)).toBe(true);
    expect(isRetryableHttpStatus(429)).toBe(true);
    expect(isRetryableHttpStatus(503)).toBe(true);
    expect(isRetryableHttpStatus(400)).toBe(false);
    expect(isRetryableHttpStatus(401)).toBe(false);
  });

  it('uses short bounded backoff', () => {
    expect(retryDelayMs(1)).toBe(500);
    expect(retryDelayMs(2)).toBe(1_000);
    expect(retryDelayMs(20)).toBe(2_000);
  });
});

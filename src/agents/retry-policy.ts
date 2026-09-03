const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

export function isRetryableHttpStatus(status: number): boolean {
  return RETRYABLE_HTTP_STATUSES.has(status);
}

export function retryDelayMs(completedAttempts: number): number {
  return Math.min(2_000, 500 * (2 ** Math.max(0, completedAttempts - 1)));
}

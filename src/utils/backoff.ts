/**
 * Calculate exponential backoff delay
 * Formula: min(1000 * 2^attempt, maxDelay)
 */
export function calculateBackoff(attempt: number, maxDelay = 60000): number {
  const delay = Math.min(1000 * Math.pow(2, attempt), maxDelay);
  // Add jitter (±20%) to prevent thundering herd
  const jitter = delay * 0.2 * (Math.random() - 0.5);
  return Math.floor(delay + jitter);
}

/**
 * Default retry delay function
 */
export const defaultRetryDelay = (attempt: number): number => {
  return calculateBackoff(attempt);
};

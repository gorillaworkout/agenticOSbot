/**
 * Resilient execution with retry + circuit breaker (GOR-132)
 * Protects against transient failures in LLM, Lark API, and tool execution.
 */

import { childLogger } from './logger';

const log = childLogger('resilient');

// === Circuit Breaker ===
type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitEntry {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
}

const circuits = new Map<string, CircuitEntry>();
const CIRCUIT_THRESHOLD = 5;        // failures before opening
const CIRCUIT_RESET_MS = 30_000;    // 30s before half-open
const CIRCUIT_HALF_OPEN_MAX = 2;    // attempts in half-open

function getCircuit(key: string): CircuitEntry {
  if (!circuits.has(key)) {
    circuits.set(key, { state: 'closed', failures: 0, lastFailure: 0, lastSuccess: 0 });
  }
  return circuits.get(key)!;
}

export function getCircuitState(key: string): CircuitEntry | undefined {
  return circuits.get(key);
}

function recordSuccess(key: string) {
  const c = getCircuit(key);
  c.state = 'closed';
  c.failures = 0;
  c.lastSuccess = Date.now();
}

function recordFailure(key: string) {
  const c = getCircuit(key);
  c.failures++;
  c.lastFailure = Date.now();
  if (c.failures >= CIRCUIT_THRESHOLD) {
    c.state = 'open';
    log.warn({ key, failures: c.failures }, 'Circuit OPEN');
  }
}

function isCircuitAllowed(key: string): boolean {
  const c = getCircuit(key);
  if (c.state === 'closed') return true;
  if (c.state === 'open') {
    if (Date.now() - c.lastFailure > CIRCUIT_RESET_MS) {
      c.state = 'half-open';
      log.info({ key }, 'Circuit HALF-OPEN (probing)');
      return true;
    }
    return false;
  }
  // half-open: allow limited attempts
  return true;
}

// === Retry with exponential backoff ===
interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: (error: unknown) => boolean;
  circuitKey?: string;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

function isRetryable(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    // Check for HTTP status codes in error message
    for (const code of RETRYABLE_STATUS) {
      if (msg.includes(String(code))) return true;
    }
    // Network errors
    if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') || msg.includes('fetch failed')) return true;
    if (msg.includes('timeout') || msg.includes('TIMEOUT')) return true;
    // Abort errors
    if (msg.includes('aborted') || msg.includes('AbortError')) return true;
  }
  return false;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    retryOn = isRetryable,
    circuitKey,
  } = options;

  // Check circuit breaker
  if (circuitKey && !isCircuitAllowed(circuitKey)) {
    throw new Error(`Circuit breaker OPEN for ${circuitKey}. Service temporarily unavailable.`);
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await fn();
      if (circuitKey) recordSuccess(circuitKey);
      return result;
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts || !retryOn(error)) {
        if (circuitKey) recordFailure(circuitKey);
        throw error;
      }

      // Exponential backoff with jitter
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1) + Math.random() * 500, maxDelayMs);
      log.warn({ attempt, maxAttempts, delay: Math.round(delay), error: String(error).slice(0, 100), circuitKey }, 'Retryable error, retrying...');
      await new Promise(r => setTimeout(r, delay));
    }
  }

  throw lastError;
}

// === LLM-specific resilient wrapper ===
export async function withLLMRetry<T>(fn: () => Promise<T>): Promise<T> {
  return withRetry(fn, {
    maxAttempts: 3,
    baseDelayMs: 2000,
    maxDelayMs: 60_000,
    circuitKey: 'llm',
    retryOn: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Retry on rate limit, server errors, timeouts
      if (msg.includes('429') || msg.includes('500') || msg.includes('502') || msg.includes('503')) return true;
      if (msg.includes('timeout') || msg.includes('ECONNRESET')) return true;
      // Don't retry on auth errors or bad requests
      if (msg.includes('401') || msg.includes('403') || msg.includes('400')) return false;
      return isRetryable(err);
    },
  });
}

// === Tool execution resilient wrapper ===
export async function withToolRetry<T>(fn: () => Promise<T>, toolName: string): Promise<T> {
  return withRetry(fn, {
    maxAttempts: 2,
    baseDelayMs: 1000,
    circuitKey: `tool:${toolName}`,
    retryOn: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      // Only retry on transient errors, not logic errors
      if (msg.includes('timeout') || msg.includes('ECONNRESET') || msg.includes('fetch failed')) return true;
      return false;
    },
  });
}

// === Status endpoint data ===
export function getCircuitBreakerStatus(): Record<string, CircuitEntry> {
  const status: Record<string, CircuitEntry> = {};
  for (const [key, entry] of circuits) {
    status[key] = { ...entry };
  }
  return status;
}

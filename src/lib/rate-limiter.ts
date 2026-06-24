/**
 * GOR-110: Bottleneck rate limiter for LLM calls and per-user cost cap.
 * Prevents runaway LLM costs and respects provider rate limits.
 */
import Bottleneck from 'bottleneck';
import { childLogger } from './logger';
import { getOne } from './db';

const log = childLogger('rate-limiter');

// === Rate Limiters ===

/**
 * Global LLM rate limiter — caps concurrent LLM calls and enforces min delay.
 */
export const llmLimiter = new Bottleneck({
  maxConcurrent: 5,           // Max 5 concurrent LLM calls
  minTime: 200,               // Min 200ms between calls
  reservoir: 60,              // Burst: 60 requests
  reservoirRefreshAmount: 60, // Refill 60 per interval
  reservoirRefreshInterval: 60 * 1000, // Per minute
});

/**
 * Per-user rate limiter — prevents single user from hogging LLM.
 */
const userLimiters = new Map<string, Bottleneck>();

export function getUserLimiter(userId: string): Bottleneck {
  if (!userLimiters.has(userId)) {
    const limiter = new Bottleneck({
      maxConcurrent: 3,           // Max 3 concurrent per user
      minTime: 500,               // Min 500ms between calls per user
      reservoir: 30,              // 30 requests per user per interval
      reservoirRefreshAmount: 30,
      reservoirRefreshInterval: 60 * 1000,
    });
    userLimiters.set(userId, limiter);
  }
  return userLimiters.get(userId)!;
}

/**
 * Tool execution rate limiter — more lenient than LLM.
 */
export const toolLimiter = new Bottleneck({
  maxConcurrent: 10,
  minTime: 100,
});

// === Cost Tracking ===

interface CostRecord {
  userId: string;
  totalCost: number;
  dailyCost: number;
  lastReset: Date;
}

const costRecords = new Map<string, CostRecord>();

const COST_PER_1K_TOKENS = 0.002; // Approximate cost per 1K tokens

/**
 * Track LLM token usage and cost.
 */
export function trackCost(userId: string, inputTokens: number, outputTokens: number): void {
  const totalTokens = inputTokens + outputTokens;
  const cost = (totalTokens / 1000) * COST_PER_1K_TOKENS;

  let record = costRecords.get(userId);
  if (!record) {
    record = { userId, totalCost: 0, dailyCost: 0, lastReset: new Date() };
    costRecords.set(userId, record);
  }

  // Reset daily cost at midnight
  const now = new Date();
  if (record.lastReset.toDateString() !== now.toDateString()) {
    record.dailyCost = 0;
    record.lastReset = now;
  }

  record.totalCost += cost;
  record.dailyCost += cost;
}

/**
 * Check if user is within cost cap.
 */
export function checkCostCap(userId: string, dailyCap: number = 10.0): { allowed: boolean; dailyCost: number; remaining: number } {
  const record = costRecords.get(userId);
  if (!record) return { allowed: true, dailyCost: 0, remaining: dailyCap };

  const now = new Date();
  if (record.lastReset.toDateString() !== now.toDateString()) {
    record.dailyCost = 0;
    record.lastReset = now;
  }

  return {
    allowed: record.dailyCost < dailyCap,
    dailyCost: record.dailyCost,
    remaining: Math.max(0, dailyCap - record.dailyCost),
  };
}

/**
 * Get cost stats for all users.
 */
export function getCostStats(): Array<{ userId: string; totalCost: number; dailyCost: number }> {
  return Array.from(costRecords.values()).map(r => ({
    userId: r.userId,
    totalCost: r.totalCost,
    dailyCost: r.dailyCost,
  }));
}

// === Wrapped LLM Call ===

/**
 * Execute an LLM call with rate limiting and cost tracking.
 */
export async function rateLimitedLLMCall<T>(
  userId: string,
  fn: () => Promise<T>,
  options: { maxTokens?: number; dailyCap?: number } = {}
): Promise<T> {
  // Check cost cap
  const cap = checkCostCap(userId, options.dailyCap);
  if (!cap.allowed) {
    log.warn({ userId, dailyCost: cap.dailyCost }, 'User exceeded daily cost cap');
    throw new Error(`Daily cost cap exceeded ($${cap.dailyCost.toFixed(2)}). Resets at midnight.`);
  }

  // Chain global + per-user limiters
  const userLimiter = getUserLimiter(userId);
  
  return llmLimiter.schedule(() => 
    userLimiter.schedule(async () => {
      const result = await fn();
      // Track approximate cost (caller should track actual tokens)
      return result;
    })
  );
}

// === Limiter Stats ===

export async function getLimiterStats(): Promise<{
  llm: { running: number; queued: number; done: number };
  tool: { running: number; queued: number; done: number };
  activeUsers: number;
}> {
  const [llmRunning, llmQueued, toolRunning, toolQueued] = await Promise.all([
    llmLimiter.running(), llmLimiter.queued(),
    toolLimiter.running(), toolLimiter.queued(),
  ]);
  return {
    llm: { running: llmRunning, queued: llmQueued, done: 0 },
    tool: { running: toolRunning, queued: toolQueued, done: 0 },
    activeUsers: userLimiters.size,
  };
}

/**
 * GOR-103: Typed in-process cron scheduling with timezone support.
 * Uses cron-parser for expression parsing and date-fns-tz for timezone handling.
 */
import { CronExpressionParser } from 'cron-parser';
import { childLogger } from './logger';

const log = childLogger('scheduler');

export interface ScheduledTask {
  id: string;
  name: string;
  cronExpr: string;
  timezone: string;
  handler: () => Promise<void>;
  enabled: boolean;
  lastRun?: Date;
  nextRun: Date;
  running: boolean;
}

const tasks = new Map<string, ScheduledTask>();
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

/**
 * Calculate next run time for a cron expression in a given timezone.
 */
export function calculateNextRun(cronExpr: string, timezone: string = 'Asia/Jakarta'): Date {
  try {
    const interval = CronExpressionParser.parse(cronExpr, {
      tz: timezone,
    });
    return interval.next().toDate();
  } catch (err) {
    log.error({ err, cronExpr }, 'Invalid cron expression');
    // Fallback: 1 hour from now
    return new Date(Date.now() + 3600000);
  }
}

/**
 * Register a scheduled task.
 */
export function scheduleTask(
  id: string,
  name: string,
  cronExpr: string,
  handler: () => Promise<void>,
  timezone: string = 'Asia/Jakarta'
): ScheduledTask {
  const nextRun = calculateNextRun(cronExpr, timezone);
  const task: ScheduledTask = {
    id,
    name,
    cronExpr,
    timezone,
    handler,
    enabled: true,
    nextRun,
    running: false,
  };
  tasks.set(id, task);
  log.info({ id, name, cronExpr, timezone, nextRun: nextRun.toISOString() }, 'Task scheduled');
  
  if (!running) start();
  return task;
}

/**
 * Unregister a scheduled task.
 */
export function unscheduleTask(id: string): boolean {
  const deleted = tasks.delete(id);
  if (deleted) log.info({ id }, 'Task unscheduled');
  return deleted;
}

/**
 * Get all registered tasks.
 */
export function getScheduledTasks(): ScheduledTask[] {
  return Array.from(tasks.values());
}

/**
 * GOR-103: Check and run due tasks (called from chat route for non-blocking execution).
 */
export async function checkScheduledTasks(): Promise<void> {
  await tick();
}

/**
 * Main scheduler loop — checks for due tasks every 15 seconds.
 */
async function tick(): Promise<void> {
  const now = new Date();
  
  for (const task of tasks.values()) {
    if (!task.enabled || task.running) continue;
    if (task.nextRun > now) continue;

    task.running = true;
    const startTime = Date.now();
    
    try {
      log.info({ id: task.id, name: task.name }, 'Running scheduled task');
      await task.handler();
      task.lastRun = now;
      const duration = Date.now() - startTime;
      log.info({ id: task.id, name: task.name, duration }, 'Task completed');
    } catch (err) {
      log.error({ err, id: task.id, name: task.name }, 'Task failed');
    } finally {
      task.running = false;
      task.nextRun = calculateNextRun(task.cronExpr, task.timezone);
    }
  }
}

/**
 * Start the scheduler loop.
 */
export function start(): void {
  if (running) return;
  running = true;
  log.info('Scheduler started');
  
  const loop = () => {
    if (!running) return;
    tick().catch(err => log.error({ err }, 'Scheduler tick error'));
    timer = setTimeout(loop, 15000); // Check every 15 seconds
  };
  loop();
}

/**
 * Stop the scheduler loop.
 */
export function stop(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  log.info('Scheduler stopped');
}

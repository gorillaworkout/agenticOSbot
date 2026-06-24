/**
 * GOR-102: BullMQ job queue — persistent, distributed task scheduling.
 * Replaces in-process cron with Redis-backed durable jobs.
 */
import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { childLogger } from './logger';

const log = childLogger('job-queue');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const connection = { url: REDIS_URL };

// === Queues ===

export const proactiveQueue = new Queue('proactive', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
  },
});

export const scheduledQueue = new Queue('scheduled', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
  },
});

export const emailQueue = new Queue('email', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 100 },
    attempts: 5,
    backoff: { type: 'exponential', delay: 15000 },
  },
});

export const cronQueue = new Queue('cron', {
  connection,
  defaultJobOptions: {
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 25 },
  },
});

// === Job Types ===

export interface ProactiveJobData {
  type: 'morning_briefing' | 'approval_check' | 'meeting_reminder' | 'daily_digest' | 'deadline_tracker';
  appId?: string;
  [key: string]: unknown;
}

export interface ScheduledJobData {
  name: string;
  payload: Record<string, unknown>;
  appId?: string;
}

export interface EmailJobData {
  to: string;
  subject: string;
  html: string;
  from?: string;
}

export interface CronJobData {
  name: string;
  cron: string;
  payload: Record<string, unknown>;
  appId?: string;
}

// === Queue Events ===

export const proactiveEvents = new QueueEvents('proactive', { connection });
export const scheduledEvents = new QueueEvents('scheduled', { connection });
export const emailEvents = new QueueEvents('email', { connection });
export const cronEvents = new QueueEvents('cron', { connection });

// === Job Scheduling ===

export async function scheduleProactiveJob(data: ProactiveJobData, delayMs = 0) {
  const job = await proactiveQueue.add(data.type, data, {
    delay: delayMs,
  });
  log.info(`Scheduled proactive job: ${data.type} (${job.id})`);
  return job;
}

export async function scheduleRecurringJob(queueName: string, jobName: string, data: Record<string, unknown>, repeat: { every?: number; pattern?: string }) {
  const queue = queueName === 'proactive' ? proactiveQueue
    : queueName === 'scheduled' ? scheduledQueue
    : queueName === 'email' ? emailQueue
    : cronQueue;

  const job = await queue.add(jobName, data, {
    repeat,
  });
  log.info(`Scheduled recurring job: ${jobName} in ${queueName} (${job.id})`);
  return job;
}

export async function scheduleEmail(data: EmailJobData, delayMs = 0) {
  const job = await emailQueue.add('send-email', data, { delay: delayMs });
  log.info(`Queued email to ${data.to}: ${data.subject} (${job.id})`);
  return job;
}

// === Job Status ===

export async function getQueueStatus(queueName: string) {
  const queue = queueName === 'proactive' ? proactiveQueue
    : queueName === 'scheduled' ? scheduledQueue
    : queueName === 'email' ? emailQueue
    : cronQueue;

  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);

  return { name: queueName, waiting, active, completed, failed, delayed };
}

export async function getAllQueueStatus() {
  return Promise.all([
    getQueueStatus('proactive'),
    getQueueStatus('scheduled'),
    getQueueStatus('email'),
    getQueueStatus('cron'),
  ]);
}

export async function getJobCounts() {
  const [proactive, scheduled, email, cron] = await Promise.all([
    proactiveQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    scheduledQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    emailQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
    cronQueue.getJobCounts('waiting', 'active', 'completed', 'failed'),
  ]);
  return { proactive, scheduled, email, cron };
}

// === Pause/Resume ===

export async function pauseQueue(queueName: string) {
  const queue = queueName === 'proactive' ? proactiveQueue
    : queueName === 'scheduled' ? scheduledQueue
    : queueName === 'email' ? emailQueue
    : cronQueue;
  await queue.pause();
  log.info(`Paused queue: ${queueName}`);
}

export async function resumeQueue(queueName: string) {
  const queue = queueName === 'proactive' ? proactiveQueue
    : queueName === 'scheduled' ? scheduledQueue
    : queueName === 'email' ? emailQueue
    : cronQueue;
  await queue.resume();
  log.info(`Resumed queue: ${queueName}`);
}

// === Graceful Shutdown ===

export async function closeQueues() {
  await Promise.all([
    proactiveQueue.close(),
    scheduledQueue.close(),
    emailQueue.close(),
    cronQueue.close(),
  ]);
  log.info('All queues closed');
}

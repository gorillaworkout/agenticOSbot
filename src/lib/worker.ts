/**
 * GOR-102: BullMQ worker — processes jobs from all queues.
 * Separated from job-queue.ts for clean worker/consumer pattern.
 */
import { Worker, Job } from 'bullmq';
import { childLogger } from './logger';
import type { ProactiveJobData, EmailJobData, ScheduledJobData, CronJobData } from './job-queue';

type JobData = ProactiveJobData | EmailJobData | ScheduledJobData | CronJobData;

const log = childLogger('worker');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const connection = { url: REDIS_URL };

// Adapter functions for worker — delegates to proactive.ts
async function getMorningBriefing(appId?: string) {
  const { runMorningBriefing } = await import('./proactive');
  return runMorningBriefing('system', appId || '', '');
}
async function checkApprovals(appId?: string) {
  // Placeholder — approval check needs chatId, will be wired from webhook
  return [];
}
async function checkUpcomingMeetings(appId?: string) {
  const { checkMeetingReminders } = await import('./proactive');
  await checkMeetingReminders('system', appId || '', '');
  return [];
}
async function getDailyDigest(appId?: string) {
  const { runDailyChatSummary } = await import('./proactive');
  return runDailyChatSummary('system', appId || '', '');
}
async function checkDeadlines(appId?: string) {
  const { runDeadlineTracker } = await import('./proactive');
  return runDeadlineTracker('system', appId || '', '');
}

// === Proactive Worker ===

const proactiveWorker = new Worker<ProactiveJobData>('proactive', async (job: Job<ProactiveJobData>) => {
  log.info(`Processing proactive job: ${job.data.type} (${job.id})`);

  try {
    switch (job.data.type) {
      case 'morning_briefing':
        return { success: true, briefing: await getMorningBriefing(job.data.appId) };
      case 'approval_check':
        return { success: true, count: (await checkApprovals(job.data.appId)).length };
      case 'meeting_reminder':
        return { success: true, count: (await checkUpcomingMeetings(job.data.appId)).length };
      case 'daily_digest':
        return { success: true, digest: await getDailyDigest(job.data.appId) };
      case 'deadline_tracker':
        return { success: true, count: (await checkDeadlines(job.data.appId)).length };
      default:
        log.warn(`Unknown proactive job type: ${(job.data as ProactiveJobData).type}`);
        return { success: false, error: 'Unknown job type' };
    }
  } catch (err) {
    log.error(`Proactive job failed: ${job.data.type} — ${String(err)}`);
    throw err;
  }
}, { connection, concurrency: 2 });

// === Email Worker ===

const emailWorker = new Worker<EmailJobData>('email', async (job: Job<EmailJobData>) => {
  log.info(`Sending email to ${job.data.to}: ${job.data.subject} (${job.id})`);

  try {
    const { sendNotificationEmail } = await import('./email');
    const result = await sendNotificationEmail(job.data.to, job.data.subject, job.data.html);
    log.info(`Email sent to ${job.data.to}`);
    return { success: true, result };
  } catch (err) {
    log.error(`Email send failed to ${job.data.to} — ${String(err)}`);
    throw err;
  }
}, { connection, concurrency: 3 });

// === Scheduled Worker ===

const scheduledWorker = new Worker<ScheduledJobData>('scheduled', async (job: Job<ScheduledJobData>) => {
  log.info(`Processing scheduled job: ${job.data.name} (${job.id})`);

  try {
    // Execute the scheduled task via tools
    const { executeTool } = await import('./tools');
    const { name, payload } = job.data;

    // Map scheduled job name to tool execution
    if (name.startsWith('tool:')) {
      const toolName = name.replace('tool:', '');
      const result = await executeTool(toolName, payload, { appId: job.data.appId });
      return { success: true, result };
    }

    log.warn(`Unknown scheduled job: ${name}`);
    return { success: false, error: 'Unknown scheduled job type' };
  } catch (err) {
    log.error(`Scheduled job failed: ${job.data.name} — ${String(err)}`);
    throw err;
  }
}, { connection, concurrency: 2 });

// === Cron Worker ===

const cronWorker = new Worker<CronJobData>('cron', async (job: Job<CronJobData>) => {
  log.info(`Processing cron job: ${job.data.name} (${job.id})`);

  try {
    const { executeTool } = await import('./tools');
    const result = await executeTool(
      job.data.payload.tool as string,
      job.data.payload.args as Record<string, unknown>,
      { appId: job.data.appId },
    );
    return { success: true, result };
  } catch (err) {
    log.error(`Cron job failed: ${job.data.name} — ${String(err)}`);
    throw err;
  }
}, { connection, concurrency: 1 });

// === Error Handlers ===

[proactiveWorker, emailWorker, scheduledWorker, cronWorker].forEach((worker) => {
  worker.on('failed', (job: Job | undefined, err: Error) => {
    log.error(`Job ${job?.id} failed: ${err.message}`);
  });

  worker.on('error', (err: Error) => {
    log.error(`Worker error: ${err.message}`);
  });
});

log.info('All workers started');

// === Graceful Shutdown ===

export async function closeWorkers() {
  await Promise.all([
    proactiveWorker.close(),
    emailWorker.close(),
    scheduledWorker.close(),
    cronWorker.close(),
  ]);
  log.info('All workers closed');
}

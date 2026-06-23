import { getMany, query } from './db';
import { executeTool } from './tools';
import { childLogger } from './logger';

const log = childLogger('scheduler');

/**
 * Check and execute due scheduled tasks.
 * Called from health endpoint or chat route as a lightweight trigger.
 * Returns number of tasks executed.
 */
export async function checkScheduledTasks(): Promise<number> {
  try {
    const dueTasks = await getMany<{
      id: string;
      user_id: string;
      name: string;
      task_type: string;
      schedule: string;
      payload: Record<string, unknown>;
    }>(
      `SELECT id, user_id, name, task_type, schedule, payload
       FROM scheduled_tasks
       WHERE enabled = true AND next_run_at <= now()
       LIMIT 5`
    );

    if (dueTasks.length === 0) return 0;

    let executed = 0;
    for (const task of dueTasks) {
      try {
        log.info({ taskId: task.id, name: task.name, type: task.task_type }, 'Executing scheduled task');

        const payload = task.payload || {};

        // Execute the payload tool if specified
        if (payload.tool && typeof payload.tool === 'string') {
          await executeTool(payload.tool, (payload.args as Record<string, unknown>) || {});
        }

        // Update timestamps
        const nextRun = computeNextRun(task.task_type, task.schedule);
        if (task.task_type === 'once') {
          await query(
            'UPDATE scheduled_tasks SET last_run_at = now(), next_run_at = NULL, enabled = false, updated_at = now() WHERE id = $1',
            [task.id]
          );
        } else {
          await query(
            'UPDATE scheduled_tasks SET last_run_at = now(), next_run_at = $1, updated_at = now() WHERE id = $2',
            [nextRun, task.id]
          );
        }
        executed++;
      } catch (e) {
        log.error({ err: e, taskId: task.id }, 'Scheduled task execution failed');
        // Still update last_run_at to prevent retry storm
        await query('UPDATE scheduled_tasks SET last_run_at = now(), updated_at = now() WHERE id = $1', [task.id]);
      }
    }

    return executed;
  } catch (e) {
    log.error({ err: e }, 'Scheduler check failed');
    return 0;
  }
}

function computeNextRun(taskType: string, schedule: string): Date {
  if (taskType === 'interval') return new Date(Date.now() + parseInt(schedule, 10));
  if (taskType === 'cron') return new Date(Date.now() + 60_000); // simplified: next minute
  return new Date(Date.now() + 60_000);
}

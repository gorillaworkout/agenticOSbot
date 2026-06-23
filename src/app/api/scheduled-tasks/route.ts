import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseBody, parseSearchParams } from '@/lib/api';
import { z } from 'zod';

const CreateTaskSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  taskType: z.enum(['cron', 'interval', 'once']),
  schedule: z.string().min(1), // cron expression or ms
  payload: z.record(z.string(), z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

function computeNextRun(taskType: string, schedule: string): Date {
  if (taskType === 'once') return new Date(Date.now() + 1000); // immediately eligible
  if (taskType === 'interval') return new Date(Date.now() + parseInt(schedule, 10));
  // cron: next run is next minute (simplified — real cron parsing would use a library)
  return new Date(Date.now() + 60_000);
}

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { page, pageSize } = parseSearchParams(request.url);

  const countRow = await getOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM scheduled_tasks WHERE user_id = $1', [user!.id]
  );
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;

  const items = await getMany(
    'SELECT * FROM scheduled_tasks WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
    [user!.id, pageSize, offset]
  );

  return paginated(items, total, page, pageSize);
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const body = await parseBody<z.infer<typeof CreateTaskSchema>>(request);
  const parsed = CreateTaskSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const { name, description, taskType, schedule, payload, enabled } = parsed.data;
  const nextRun = enabled ? computeNextRun(taskType, schedule) : null;

  const item = await getOne(
    `INSERT INTO scheduled_tasks (user_id, name, description, task_type, schedule, payload, enabled, next_run_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [user!.id, name, description || null, taskType, schedule, JSON.stringify(payload), enabled, nextRun]
  );

  return ok(item, 201);
}

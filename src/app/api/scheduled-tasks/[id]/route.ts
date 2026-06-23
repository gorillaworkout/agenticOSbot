import { getOne, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const UpdateTaskSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  taskType: z.enum(['cron', 'interval', 'once']).optional(),
  schedule: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const item = await getOne(
    'SELECT * FROM scheduled_tasks WHERE id = $1 AND user_id = $2',
    [id, user!.id]
  );
  if (!item) return err('Task not found', 404);
  return ok(item);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const body = await parseBody<z.infer<typeof UpdateTaskSchema>>(request);
  const parsed = UpdateTaskSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (parsed.data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(parsed.data.name); }
  if (parsed.data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(parsed.data.description); }
  if (parsed.data.taskType !== undefined) { fields.push(`task_type = $${idx++}`); values.push(parsed.data.taskType); }
  if (parsed.data.schedule !== undefined) { fields.push(`schedule = $${idx++}`); values.push(parsed.data.schedule); }
  if (parsed.data.payload !== undefined) { fields.push(`payload = $${idx++}`); values.push(JSON.stringify(parsed.data.payload)); }
  if (parsed.data.enabled !== undefined) { fields.push(`enabled = $${idx++}`); values.push(parsed.data.enabled); }

  if (fields.length === 0) return err('No fields to update', 400);
  fields.push(`updated_at = now()`);
  values.push(id, user!.id);

  const item = await getOne(
    `UPDATE scheduled_tasks SET ${fields.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
    values
  );
  if (!item) return err('Task not found', 404);
  return ok(item);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const result = await query(
    'DELETE FROM scheduled_tasks WHERE id = $1 AND user_id = $2',
    [id, user!.id]
  );
  if (result.rowCount === 0) return err('Task not found', 404);
  return ok({ deleted: true });
}

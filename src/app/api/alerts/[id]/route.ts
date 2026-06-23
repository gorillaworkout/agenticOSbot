import { getOne, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const UpdateAlertSchema = z.object({
  name: z.string().min(1).optional(),
  metricName: z.string().min(1).optional(),
  condition: z.enum(['gt', 'lt', 'eq', 'gte', 'lte']).optional(),
  threshold: z.number().optional(),
  windowMinutes: z.number().int().min(1).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const item = await getOne('SELECT * FROM alerts WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (!item) return err('Alert not found', 404);
  return ok(item);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const body = await parseBody<z.infer<typeof UpdateAlertSchema>>(request);
  const parsed = UpdateAlertSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (parsed.data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(parsed.data.name); }
  if (parsed.data.metricName !== undefined) { fields.push(`metric_name = $${idx++}`); values.push(parsed.data.metricName); }
  if (parsed.data.condition !== undefined) { fields.push(`condition = $${idx++}`); values.push(parsed.data.condition); }
  if (parsed.data.threshold !== undefined) { fields.push(`threshold = $${idx++}`); values.push(parsed.data.threshold); }
  if (parsed.data.windowMinutes !== undefined) { fields.push(`window_minutes = $${idx++}`); values.push(parsed.data.windowMinutes); }
  if (parsed.data.enabled !== undefined) { fields.push(`enabled = $${idx++}`); values.push(parsed.data.enabled); }

  if (fields.length === 0) return err('No fields to update', 400);
  fields.push(`updated_at = now()`);
  values.push(id, user!.id);

  const item = await getOne(`UPDATE alerts SET ${fields.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`, values);
  if (!item) return err('Alert not found', 404);
  return ok(item);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const result = await query('DELETE FROM alerts WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (result.rowCount === 0) return err('Alert not found', 404);
  return ok({ deleted: true });
}

export const dynamic = 'force-dynamic';

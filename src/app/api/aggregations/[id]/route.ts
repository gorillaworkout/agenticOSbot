import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const UpdateAggSchema = z.object({
  name: z.string().min(1).optional(),
  sourceTable: z.string().min(1).optional(),
  groupByFields: z.array(z.string()).optional(),
  aggregations: z.record(z.string(), z.string()).optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
  schedule: z.string().nullable().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const item = await getOne('SELECT * FROM aggregations WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (!item) return err('Aggregation not found', 404);
  return ok(item);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const body = await parseBody<z.infer<typeof UpdateAggSchema>>(request);
  const parsed = UpdateAggSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (parsed.data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(parsed.data.name); }
  if (parsed.data.sourceTable !== undefined) { fields.push(`source_table = $${idx++}`); values.push(parsed.data.sourceTable); }
  if (parsed.data.groupByFields !== undefined) { fields.push(`group_by_fields = $${idx++}`); values.push(JSON.stringify(parsed.data.groupByFields)); }
  if (parsed.data.aggregations !== undefined) { fields.push(`aggregations = $${idx++}`); values.push(JSON.stringify(parsed.data.aggregations)); }
  if (parsed.data.filter !== undefined) { fields.push(`filter = $${idx++}`); values.push(JSON.stringify(parsed.data.filter)); }
  if (parsed.data.schedule !== undefined) { fields.push(`schedule = $${idx++}`); values.push(parsed.data.schedule); }
  if (fields.length === 0) return err('No fields to update', 400);
  fields.push(`updated_at = now()`);
  values.push(id, user!.id);
  const item = await getOne(`UPDATE aggregations SET ${fields.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`, values);
  if (!item) return err('Aggregation not found', 404);
  return ok(item);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const result = await query('DELETE FROM aggregations WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (result.rowCount === 0) return err('Aggregation not found', 404);
  return ok({ deleted: true });
}

export const dynamic = 'force-dynamic';

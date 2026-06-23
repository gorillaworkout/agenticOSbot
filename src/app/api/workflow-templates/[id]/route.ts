import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const UpdateTemplateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  steps: z.array(z.object({
    type: z.enum(['tool_call', 'llm_prompt', 'condition', 'human_approval']),
    name: z.string().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    dependsOn: z.number().optional(),
    parallel: z.boolean().optional(),
    parallelGroup: z.number().optional(),
    maxRetries: z.number().int().optional(),
    retryDelayMs: z.number().int().optional(),
  })).optional(),
  public: z.boolean().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const item = await getOne('SELECT * FROM workflow_templates WHERE id = $1 AND (user_id = $2 OR public = true)', [id, user!.id]);
  if (!item) return err('Template not found', 404);
  return ok(item);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const body = await parseBody<z.infer<typeof UpdateTemplateSchema>>(request);
  const parsed = UpdateTemplateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (parsed.data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(parsed.data.name); }
  if (parsed.data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(parsed.data.description); }
  if (parsed.data.category !== undefined) { fields.push(`category = $${idx++}`); values.push(parsed.data.category); }
  if (parsed.data.steps !== undefined) { fields.push(`steps = $${idx++}`); values.push(JSON.stringify(parsed.data.steps)); }
  if (parsed.data.public !== undefined) { fields.push(`public = $${idx++}`); values.push(parsed.data.public); }
  if (fields.length === 0) return err('No fields to update', 400);
  fields.push(`updated_at = now()`);
  values.push(id, user!.id);
  const item = await getOne(`UPDATE workflow_templates SET ${fields.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`, values);
  if (!item) return err('Template not found', 404);
  return ok(item);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const result = await query('DELETE FROM workflow_templates WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (result.rowCount === 0) return err('Template not found', 404);
  return ok({ deleted: true });
}

export const dynamic = 'force-dynamic';

import { getOne, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  steps: z.array(z.object({
    type: z.enum(['tool_call', 'llm_prompt', 'condition', 'human_approval']),
    name: z.string().optional(),
    config: z.record(z.string(), z.unknown()).default({}),
    dependsOn: z.number().optional(),
  })).optional(),
  enabled: z.boolean().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const item = await getOne(
    'SELECT * FROM workflows WHERE id = $1 AND user_id = $2',
    [id, user!.id]
  );
  if (!item) return err('Workflow not found', 404);
  return ok(item);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const body = await parseBody<z.infer<typeof UpdateWorkflowSchema>>(request);
  const parsed = UpdateWorkflowSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (parsed.data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(parsed.data.name); }
  if (parsed.data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(parsed.data.description); }
  if (parsed.data.steps !== undefined) { fields.push(`steps = $${idx++}`); values.push(JSON.stringify(parsed.data.steps)); }
  if (parsed.data.enabled !== undefined) { fields.push(`enabled = $${idx++}`); values.push(parsed.data.enabled); }

  if (fields.length === 0) return err('No fields to update', 400);
  fields.push(`updated_at = now()`);
  values.push(id, user!.id);

  const item = await getOne(
    `UPDATE workflows SET ${fields.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`,
    values
  );
  if (!item) return err('Workflow not found', 404);
  return ok(item);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const result = await query('DELETE FROM workflows WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (result.rowCount === 0) return err('Workflow not found', 404);
  return ok({ deleted: true });
}

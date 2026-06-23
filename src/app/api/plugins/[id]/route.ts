import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

const UpdatePluginSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  version: z.string().optional(),
  pluginType: z.enum(['tool_provider', 'webhook_handler', 'ui_component', 'scheduler']).optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  manifest: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const item = await getOne('SELECT * FROM plugins WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (!item) return err('Plugin not found', 404);
  return ok(item);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const body = await parseBody<z.infer<typeof UpdatePluginSchema>>(request);
  const parsed = UpdatePluginSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if (parsed.data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(parsed.data.name); }
  if (parsed.data.description !== undefined) { fields.push(`description = $${idx++}`); values.push(parsed.data.description); }
  if (parsed.data.version !== undefined) { fields.push(`version = $${idx++}`); values.push(parsed.data.version); }
  if (parsed.data.pluginType !== undefined) { fields.push(`plugin_type = $${idx++}`); values.push(parsed.data.pluginType); }
  if (parsed.data.config !== undefined) { fields.push(`config = $${idx++}`); values.push(JSON.stringify(parsed.data.config)); }
  if (parsed.data.manifest !== undefined) { fields.push(`manifest = $${idx++}`); values.push(JSON.stringify(parsed.data.manifest)); }
  if (fields.length === 0) return err('No fields to update', 400);
  fields.push(`updated_at = now()`);
  values.push(id, user!.id);
  const item = await getOne(`UPDATE plugins SET ${fields.join(', ')} WHERE id = $${idx} AND user_id = $${idx + 1} RETURNING *`, values);
  if (!item) return err('Plugin not found', 404);
  return ok(item);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const result = await query('DELETE FROM plugins WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (result.rowCount === 0) return err('Plugin not found', 404);
  return ok({ deleted: true });
}

export const dynamic = 'force-dynamic';

import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth, requireRole } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  // Users can view their own profile, admins can view anyone
  const { id } = await params;
  if (user!.id !== id) {
    try { requireRole(user!, 'ADMIN'); } catch (e) { return e as Response; }
  }

  const target = await getOne(
    'SELECT id, email, name, role, avatar_url, settings, created_at, updated_at FROM users WHERE id = $1',
    [id]
  );
  if (!target) return err('User not found', 404);
  return ok(target);
}

const UpdateUserSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(['ADMIN', 'USER', 'VIEWER']).optional(),
  avatarUrl: z.string().url().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const body = await parseBody<z.infer<typeof UpdateUserSchema>>(request);
  const parsed = UpdateUserSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message, 400);

  // Only admins can change roles; users can update their own name/settings
  if (parsed.data.role !== undefined) {
    try { requireRole(user!, 'ADMIN'); } catch (e) { return e as Response; }
  }
  if (user!.id !== id) {
    try { requireRole(user!, 'ADMIN'); } catch (e) { return e as Response; }
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (parsed.data.name !== undefined) { fields.push(`name = $${idx++}`); values.push(parsed.data.name); }
  if (parsed.data.role !== undefined) { fields.push(`role = $${idx++}`); values.push(parsed.data.role); }
  if (parsed.data.avatarUrl !== undefined) { fields.push(`avatar_url = $${idx++}`); values.push(parsed.data.avatarUrl); }
  if (parsed.data.settings !== undefined) { fields.push(`settings = $${idx++}`); values.push(JSON.stringify(parsed.data.settings)); }

  if (fields.length === 0) return err('No fields to update', 400);
  fields.push(`updated_at = now()`);
  values.push(id);

  const updated = await getOne(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${idx} RETURNING id, email, name, role, avatar_url, settings, created_at, updated_at`,
    values
  );
  if (!updated) return err('User not found', 404);
  return ok(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  try { requireRole(user!, 'ADMIN'); } catch (e) { return e as Response; }
  const { id } = await params;

  if (user!.id === id) return err('Cannot delete yourself', 400);

  const result = await query('DELETE FROM users WHERE id = $1', [id]);
  if (result.rowCount === 0) return err('User not found', 404);
  return ok({ deleted: true });
}

import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { id } = await params;

  const conversation = await getOne(
    'SELECT * FROM conversations WHERE id = $1 AND user_id = $2',
    [id, user!.id]
  );
  if (!conversation) return err('Conversation not found', 404);

  const messages = await getMany(
    'SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 100',
    [id]
  );

  return ok({ ...conversation, messages });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { id } = await params;
  const body = await parseBody<{ title?: string; archived?: boolean }>(request);

  const conversation = await getOne(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
    [id, user!.id]
  );
  if (!conversation) return err('Conversation not found', 404);

  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (body.title !== undefined) {
    sets.push(`title = $${idx++}`);
    values.push(body.title);
  }
  if (body.archived !== undefined) {
    sets.push(`archived = $${idx++}`);
    values.push(body.archived);
  }
  sets.push(`updated_at = NOW()`);
  values.push(id);

  const updated = await getOne(
    `UPDATE conversations SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values
  );

  return ok(updated);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { id } = await params;

  const conversation = await getOne(
    'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
    [id, user!.id]
  );
  if (!conversation) return err('Conversation not found', 404);

  await query('DELETE FROM conversations WHERE id = $1', [id]);
  return ok({ deleted: true });
}

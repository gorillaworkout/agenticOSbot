import { getOne, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const item = await getOne('UPDATE plugins SET enabled = false, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING *', [id, user!.id]);
  if (!item) return err('Plugin not found', 404);
  return ok(item);
}

export const dynamic = 'force-dynamic';

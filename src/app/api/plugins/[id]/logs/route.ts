import { getOne, getMany } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseSearchParams } from '@/lib/api';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;
  const plugin = await getOne('SELECT id FROM plugins WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (!plugin) return err('Plugin not found', 404);
  const { page, pageSize } = parseSearchParams(request.url);
  const countRow = await getOne<{ count: number }>('SELECT COUNT(*)::int as count FROM plugin_logs WHERE plugin_id = $1', [id]);
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;
  const items = await getMany('SELECT * FROM plugin_logs WHERE plugin_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [id, pageSize, offset]);
  return paginated(items, total, page, pageSize);
}

export const dynamic = 'force-dynamic';

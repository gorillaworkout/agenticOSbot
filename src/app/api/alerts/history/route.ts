import { getOne, getMany } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, paginated, parseSearchParams } from '@/lib/api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { page, pageSize } = parseSearchParams(request.url);
  const countRow = await getOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM alert_history ah JOIN alerts a ON ah.alert_id = a.id WHERE a.user_id = $1', [user!.id]
  );
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;

  const items = await getMany(
    `SELECT ah.*, a.name as alert_name, a.metric_name
     FROM alert_history ah JOIN alerts a ON ah.alert_id = a.id
     WHERE a.user_id = $1 ORDER BY ah.created_at DESC LIMIT $2 OFFSET $3`,
    [user!.id, pageSize, offset]
  );

  return paginated(items, total, page, pageSize);
}

export const dynamic = 'force-dynamic';

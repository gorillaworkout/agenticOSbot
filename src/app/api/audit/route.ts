import { getOne, getMany } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, paginated, parseSearchParams } from '@/lib/api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const { page, pageSize } = parseSearchParams(request.url);
  const action = url.searchParams.get('action');
  const resourceType = url.searchParams.get('resourceType');
  const userId = url.searchParams.get('userId');
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let idx = 1;

  if (action) { where += ` AND action = $${idx++}`; params.push(action); }
  if (resourceType) { where += ` AND resource_type = $${idx++}`; params.push(resourceType); }
  if (userId) { where += ` AND user_id = $${idx++}`; params.push(userId); }
  if (from) { where += ` AND created_at >= $${idx++}`; params.push(from); }
  if (to) { where += ` AND created_at <= $${idx++}`; params.push(to); }

  const countRow = await getOne<{ count: number }>(`SELECT COUNT(*)::int as count FROM audit_logs ${where}`, params);
  const total = countRow?.count || 0;
  const offset = (page - 1) * pageSize;

  const items = await getMany(
    `SELECT * FROM audit_logs ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, pageSize, offset]
  );

  return paginated(items, total, page, pageSize);
}

export const dynamic = 'force-dynamic';

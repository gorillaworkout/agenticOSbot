import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, paginated, parseSearchParams } from '@/lib/api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const { page, pageSize } = parseSearchParams(request.url);
  const offset = (page - 1) * pageSize;

  const countRow = await getOne<{ count: number }>(
    'SELECT COUNT(*)::int as count FROM agent_runs WHERE user_id = $1',
    [user!.id]
  );
  const total = countRow?.count || 0;

  const runs = await getMany(
    `SELECT id, conversation_id, status, input, output, tools_used, tokens_used,
            error, started_at, completed_at, created_at
     FROM agent_runs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [user!.id, pageSize, offset]
  );

  return paginated(runs, total, page, pageSize);
}

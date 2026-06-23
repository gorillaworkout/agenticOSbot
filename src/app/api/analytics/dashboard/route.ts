import { getOne, getMany } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok } from '@/lib/api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  // Today's stats
  const todayMessages = await getOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM messages WHERE created_at >= date_trunc('day', now())", []
  );
  const todayChats = await getOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM conversations WHERE created_at >= date_trunc('day', now())", []
  );
  const todayRuns = await getOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM agent_runs WHERE created_at >= date_trunc('day', now())", []
  );
  const todayErrors = await getOne<{ count: number }>(
    "SELECT COUNT(*)::int as count FROM error_logs WHERE created_at >= date_trunc('day', now())", []
  );

  // 7-day trends (messages per day)
  const messagesPerDay = await getMany<{ date: string; count: number }>(
    "SELECT date(created_at) as date, COUNT(*)::int as count FROM messages WHERE created_at >= now() - interval '7 days' GROUP BY date(created_at) ORDER BY date", []
  );

  // Top tools (last 7 days)
  const topTools = await getMany<{ tool: string; count: number }>(
    `SELECT m->>'tool' as tool, COUNT(*)::int as count
     FROM messages, jsonb_array_elements_text(metadata->'toolsUsed') as m
     WHERE created_at >= now() - interval '7 days'
     GROUP BY m->>'tool' ORDER BY count DESC LIMIT 5`, []
  );

  // Error rate (last 7 days, by source)
  const errorRate = await getMany<{ source: string; count: number }>(
    "SELECT source, COUNT(*)::int as count FROM error_logs WHERE created_at >= now() - interval '7 days' GROUP BY source ORDER BY count DESC", []
  );

  // Active users
  const activeUsers = await getOne<{ count: number }>(
    "SELECT COUNT(DISTINCT user_id)::int as count FROM conversations WHERE updated_at >= now() - interval '7 days'", []
  );

  return ok({
    today: {
      messages: todayMessages?.count || 0,
      conversations: todayChats?.count || 0,
      agentRuns: todayRuns?.count || 0,
      errors: todayErrors?.count || 0,
    },
    messagesPerDay,
    topTools,
    errorRate,
    activeUsers: activeUsers?.count || 0,
  });
}

export const dynamic = 'force-dynamic';

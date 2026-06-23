import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { z } from 'zod';

interface ReportConfig {
  timeRange?: string; // '24h', '7d', '30d'
  filters?: Record<string, unknown>;
  groupBy?: string;
}

async function generateUsageReport(config: ReportConfig) {
  const interval = config.timeRange === '7d' ? '7 days' : config.timeRange === '30d' ? '30 days' : '24 hours';

  const chatsPerDay = await getMany<{ date: string; count: number }>(
    `SELECT date(created_at) as date, COUNT(*)::int as count
     FROM messages WHERE role = 'USER' AND created_at >= now() - interval '${interval}'
     GROUP BY date(created_at) ORDER BY date`, []
  );

  const toolUsage = await getMany<{ tool: string; count: number }>(
    `SELECT m->>'tool' as tool, COUNT(*)::int as count
     FROM messages, jsonb_array_elements_text(metadata->'toolsUsed') as m
     WHERE created_at >= now() - interval '${interval}'
     GROUP BY m->>'tool' ORDER BY count DESC LIMIT 10`, []
  );

  const activeUsers = await getOne<{ count: number }>(
    `SELECT COUNT(DISTINCT user_id)::int as count FROM conversations WHERE updated_at >= now() - interval '${interval}'`, []
  );

  return { chatsPerDay, toolUsage, activeUsers: activeUsers?.count || 0 };
}

async function generateActivityReport(config: ReportConfig) {
  const interval = config.timeRange === '7d' ? '7 days' : config.timeRange === '30d' ? '30 days' : '24 hours';

  const conversations = await getOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM conversations WHERE created_at >= now() - interval '${interval}'`, []
  );

  const messages = await getOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM messages WHERE created_at >= now() - interval '${interval}'`, []
  );

  const agentRuns = await getMany<{ status: string; count: number }>(
    `SELECT status, COUNT(*)::int as count FROM agent_runs WHERE created_at >= now() - interval '${interval}'
     GROUP BY status ORDER BY count DESC`, []
  );

  return { conversations: conversations?.count || 0, messages: messages?.count || 0, agentRuns };
}

async function generatePerformanceReport(config: ReportConfig) {
  const interval = config.timeRange === '7d' ? '7 days' : config.timeRange === '30d' ? '30 days' : '24 hours';

  const avgTokens = await getOne<{ avg: number }>(
    `SELECT AVG(tokens_used)::numeric as avg FROM agent_runs WHERE created_at >= now() - interval '${interval}'`, []
  );

  const tokenUsage = await getMany<{ date: string; tokens: number }>(
    `SELECT date(created_at) as date, SUM(tokens_used)::int as tokens
     FROM agent_runs WHERE created_at >= now() - interval '${interval}'
     GROUP BY date(created_at) ORDER BY date`, []
  );

  const completedRuns = await getOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM agent_runs WHERE status = 'COMPLETED' AND created_at >= now() - interval '${interval}'`, []
  );

  const failedRuns = await getOne<{ count: number }>(
    `SELECT COUNT(*)::int as count FROM agent_runs WHERE status = 'FAILED' AND created_at >= now() - interval '${interval}'`, []
  );

  return { avgTokens: avgTokens?.avg || 0, tokenUsage, completedRuns: completedRuns?.count || 0, failedRuns: failedRuns?.count || 0 };
}

function toCSV(data: Record<string, unknown>[]): string {
  if (data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
  return [headers.join(','), ...rows].join('\n');
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const report = await getOne<{ id: string; report_type: string; config: ReportConfig }>(
    'SELECT * FROM reports WHERE id = $1 AND user_id = $2', [id, user!.id]
  );
  if (!report) return err('Report not found', 404);

  // Create history entry
  const history = await getOne<{ id: string }>(
    `INSERT INTO report_history (report_id, user_id, status) VALUES ($1, $2, 'generating') RETURNING id`,
    [id, user!.id]
  );

  try {
    let outputData: unknown;
    switch (report.report_type) {
      case 'usage': outputData = await generateUsageReport(report.config); break;
      case 'activity': outputData = await generateActivityReport(report.config); break;
      case 'performance': outputData = await generatePerformanceReport(report.config); break;
      default: outputData = { message: 'Custom report - not implemented yet' };
    }

    await query(
      `UPDATE report_history SET status = 'completed', output_data = $1 WHERE id = $2`,
      [JSON.stringify(outputData), history!.id]
    );
    await query(`UPDATE reports SET last_generated_at = now() WHERE id = $1`, [id]);

    return ok({ historyId: history!.id, status: 'completed', data: outputData });
  } catch (e) {
    await query(
      `UPDATE report_history SET status = 'failed', error = $1 WHERE id = $2`,
      [String(e), history!.id]
    );
    return err(`Report generation failed: ${String(e)}`, 500);
  }
}

export const dynamic = 'force-dynamic';

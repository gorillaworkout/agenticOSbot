import { getOne, getMany, query } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';

const SEARCHABLE_TABLES: Record<string, string> = {
  error_logs: 'error_logs',
  agent_runs: 'agent_runs',
  messages: 'messages',
  audit_logs: 'audit_logs',
};

const FIELDS: Record<string, string[]> = {
  error_logs: ['id', 'severity', 'source', 'message', 'created_at'],
  agent_runs: ['id', 'status', 'input', 'output', 'tools_used', 'tokens_used', 'created_at'],
  messages: ['id', 'role', 'content', 'created_at'],
  audit_logs: ['id', 'action', 'resource_type', 'resource_id', 'created_at'],
};

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  const url = new URL(request.url);
  const table = url.searchParams.get('table') || 'error_logs';
  const search = url.searchParams.get('q');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
  const from = url.searchParams.get('from');
  const to = url.searchParams.get('to');

  if (!SEARCHABLE_TABLES[table]) {
    return err(`Invalid table. Available: ${Object.keys(SEARCHABLE_TABLES).join(', ')}`, 400);
  }

  let where = 'WHERE 1=1';
  const params: unknown[] = [];
  let idx = 1;

  if (search) {
    const textFields = FIELDS[table].filter(f => f !== 'id' && f !== 'created_at');
    const searchClauses = textFields.map(f => `"${f}"::text ILIKE $${idx}`);
    where += ` AND (${searchClauses.join(' OR ')})`;
    params.push(`%${search}%`);
    idx++;
  }

  if (from) { where += ` AND created_at >= $${idx++}`; params.push(from); }
  if (to) { where += ` AND created_at <= $${idx++}`; params.push(to); }

  const fields = FIELDS[table].join(', ');
  const items = await getMany(
    `SELECT ${fields} FROM ${SEARCHABLE_TABLES[table]} ${where} ORDER BY created_at DESC LIMIT $${idx}`,
    [...params, limit]
  );

  return ok({ table, count: items.length, items });
}

export const dynamic = 'force-dynamic';

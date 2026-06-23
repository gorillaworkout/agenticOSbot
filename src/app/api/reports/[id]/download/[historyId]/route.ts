import { getOne, getMany } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';

export async function GET(request: Request, { params }: { params: Promise<{ id: string; historyId: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id, historyId } = await params;

  const report = await getOne('SELECT id FROM reports WHERE id = $1 AND user_id = $2', [id, user!.id]);
  if (!report) return err('Report not found', 404);

  const history = await getOne(
    'SELECT * FROM report_history WHERE id = $1 AND report_id = $2', [historyId, id]
  );
  if (!history) return err('Report history not found', 404);

  const url = new URL(request.url);
  const format = url.searchParams.get('format') || 'json';

  if (format === 'csv' && history.output_data && Array.isArray(history.output_data)) {
    const data = history.output_data as Record<string, unknown>[];
    if (data.length === 0) return new Response('No data', { status: 200 });
    const headers = Object.keys(data[0]);
    const rows = data.map(row => headers.map(h => JSON.stringify(row[h] ?? '')).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    return new Response(csv, {
      status: 200,
      headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="report-${historyId}.csv"` },
    });
  }

  return ok(history);
}

export const dynamic = 'force-dynamic';

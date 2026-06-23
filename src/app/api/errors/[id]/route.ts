import { getOne, getMany } from '@/lib/db';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const item = await getOne('SELECT * FROM error_logs WHERE id = $1', [id]);
  if (!item) return err('Error log not found', 404);
  return ok(item);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { id } = await params;

  const item = await getOne(
    'UPDATE error_logs SET resolved = true, resolved_at = now() WHERE id = $1 RETURNING *',
    [id]
  );
  if (!item) return err('Error log not found', 404);
  return ok(item);
}

export const dynamic = 'force-dynamic';

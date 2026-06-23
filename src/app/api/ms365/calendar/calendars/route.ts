import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { ms365ListCalendars } from '@/lib/microsoft365';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  try {
    const data = await ms365ListCalendars(user!.id);
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

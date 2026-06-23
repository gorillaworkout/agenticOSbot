import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { larkBitableListApps } from '@/lib/lark-api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  try {
    const data = await larkBitableListApps();
    return ok(data);
  } catch (e) {
    return err(e instanceof Error ? e.message : 'Failed to list apps', 500);
  }
}

export const dynamic = 'force-dynamic';

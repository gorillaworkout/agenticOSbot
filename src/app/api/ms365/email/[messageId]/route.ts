import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { ms365GetEmail } from '@/lib/microsoft365';

export async function GET(request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { messageId } = await params;
  try {
    const data = await ms365GetEmail(user!.id, messageId);
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

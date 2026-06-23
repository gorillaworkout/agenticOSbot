import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { larkApprovalListInstances, larkApprovalGetInstance } from '@/lib/lark-api';
import { z } from 'zod';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const url = new URL(request.url);
  try {
    const data = await larkApprovalListInstances(
      url.searchParams.get('approvalCode') || undefined,
      Number(url.searchParams.get('pageSize') || '20'),
      url.searchParams.get('pageToken') || undefined
    );
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

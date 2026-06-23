import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { larkApprovalGetInstance, larkApprovalApprove, larkApprovalReject } from '@/lib/lark-api';
import { z } from 'zod';

const ActionSchema = z.object({
  action: z.enum(['approve', 'reject']),
  userId: z.string().min(1),
  comment: z.string().optional(),
});

export async function GET(request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { instanceId } = await params;
  try {
    const data = await larkApprovalGetInstance(instanceId);
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export async function POST(request: Request, { params }: { params: Promise<{ instanceId: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { instanceId } = await params;
  const body = await parseBody(request);
  const parsed = ActionSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message);
  try {
    const { action, userId, comment } = parsed.data;
    const data = action === 'approve'
      ? await larkApprovalApprove(instanceId, userId, comment)
      : await larkApprovalReject(instanceId, userId, comment);
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

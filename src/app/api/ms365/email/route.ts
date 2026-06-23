import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { ms365SendEmail, ms365ListEmails, ms365GetEmail } from '@/lib/microsoft365';
import { z } from 'zod';

const SendSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  isHtml: z.boolean().optional(),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const url = new URL(request.url);
  try {
    const data = await ms365ListEmails(
      user!.id,
      url.searchParams.get('folder') || undefined,
      Number(url.searchParams.get('top') || '10'),
      url.searchParams.get('filter') || undefined
    );
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const body = await parseBody(request);
  const parsed = SendSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message);
  try {
    await ms365SendEmail(user!.id, parsed.data.to, parsed.data.subject, parsed.data.body, parsed.data.isHtml);
    return ok({ sent: true });
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { ms365ListCalendars, ms365ListEvents, ms365CreateEvent } from '@/lib/microsoft365';
import { z } from 'zod';

const CreateEventSchema = z.object({
  calendarId: z.string().optional(),
  subject: z.string().min(1),
  start: z.string().min(1),
  end: z.string().min(1),
  body: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  location: z.string().optional(),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const url = new URL(request.url);
  try {
    const data = await ms365ListEvents(
      user!.id,
      url.searchParams.get('calendarId') || undefined,
      url.searchParams.get('startDateTime') || undefined,
      url.searchParams.get('endDateTime') || undefined
    );
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const body = await parseBody(request);
  const parsed = CreateEventSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message);
  try {
    const d = parsed.data;
    const data = await ms365CreateEvent(user!.id, d.subject, d.start, d.end, d.body, d.attendees, d.location);
    return ok(data, 201);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { larkCalendarListCalendars, larkCalendarListEvents, larkCalendarCreateEvent } from '@/lib/lark-api';
import { parseBody } from '@/lib/api';
import { z } from 'zod';

const CreateEventSchema = z.object({
  calendarId: z.string().min(1),
  summary: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  description: z.string().optional(),
  attendees: z.array(z.string()).optional(),
  location: z.string().optional(),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const url = new URL(request.url);
  const calendarId = url.searchParams.get('calendarId');
  try {
    if (calendarId) {
      const data = await larkCalendarListEvents(
        calendarId, url.searchParams.get('startTime') || undefined, url.searchParams.get('endTime') || undefined
      );
      return ok(data);
    }
    const data = await larkCalendarListCalendars();
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
    const data = await larkCalendarCreateEvent(d.calendarId, d.summary, d.startTime, d.endTime, d.description, d.attendees, d.location);
    return ok(data, 201);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

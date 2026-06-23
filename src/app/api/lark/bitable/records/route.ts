import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { larkBitableListRecords, larkBitableCreateRecord } from '@/lib/lark-api';
import { z } from 'zod';

const CreateSchema = z.object({
  appToken: z.string().min(1),
  tableId: z.string().min(1),
  fields: z.record(z.string(), z.unknown()),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const url = new URL(request.url);
  const appToken = url.searchParams.get('appToken');
  const tableId = url.searchParams.get('tableId');
  if (!appToken || !tableId) return err('appToken and tableId required');
  try {
    const data = await larkBitableListRecords(appToken, tableId, url.searchParams.get('filter') || undefined);
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const body = await parseBody(request);
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message);
  try {
    const data = await larkBitableCreateRecord(parsed.data.appToken, parsed.data.tableId, parsed.data.fields);
    return ok(data, 201);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

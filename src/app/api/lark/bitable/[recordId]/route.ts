import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { larkBitableGetRecord, larkBitableUpdateRecord, larkBitableDeleteRecord } from '@/lib/lark-api';
import { z } from 'zod';

const UpdateSchema = z.object({ fields: z.record(z.string(), z.unknown()) });

export async function GET(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { recordId } = await params;
  const url = new URL(request.url);
  const appToken = url.searchParams.get('appToken');
  const tableId = url.searchParams.get('tableId');
  if (!appToken || !tableId) return err('appToken and tableId required');
  try {
    const data = await larkBitableGetRecord(appToken, tableId, recordId);
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export async function PUT(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { recordId } = await params;
  const url = new URL(request.url);
  const appToken = url.searchParams.get('appToken');
  const tableId = url.searchParams.get('tableId');
  if (!appToken || !tableId) return err('appToken and tableId required');
  const body = await parseBody(request);
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message);
  try {
    const data = await larkBitableUpdateRecord(appToken, tableId, recordId, parsed.data.fields);
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ recordId: string }> }) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const { recordId } = await params;
  const url = new URL(request.url);
  const appToken = url.searchParams.get('appToken');
  const tableId = url.searchParams.get('tableId');
  if (!appToken || !tableId) return err('appToken and tableId required');
  try {
    const data = await larkBitableDeleteRecord(appToken, tableId, recordId);
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err, parseBody } from '@/lib/api';
import { ms365ListFiles, ms365UploadFile, ms365CreateFolder } from '@/lib/microsoft365';
import { z } from 'zod';

const UploadSchema = z.object({
  folderId: z.string().min(1),
  fileName: z.string().min(1),
  content: z.string().min(1),
});

const FolderSchema = z.object({
  parentId: z.string().min(1),
  name: z.string().min(1),
});

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const url = new URL(request.url);
  try {
    const data = await ms365ListFiles(user!.id, url.searchParams.get('folderId') || undefined);
    return ok(data);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }
  const body = await parseBody(request);
  const parsed = UploadSchema.safeParse(body);
  if (!parsed.success) return err(parsed.error.issues[0].message);
  try {
    const d = parsed.data;
    const data = await ms365UploadFile(user!.id, d.folderId, d.fileName, d.content);
    return ok(data, 201);
  } catch (e) { return err(e instanceof Error ? e.message : 'Failed', 500); }
}

export const dynamic = 'force-dynamic';

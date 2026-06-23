import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok } from '@/lib/api';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  return ok({
    id: user!.id,
    email: user!.email,
    name: user!.name,
    role: user!.role,
  });
}

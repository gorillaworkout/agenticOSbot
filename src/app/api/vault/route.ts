import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { syncVaultToDb, getVaultStats } from '@/lib/vault';
import * as fs from 'fs/promises';
import * as path from 'path';
import matter from 'gray-matter';

const VAULT_PATH = path.join(process.cwd(), 'vault');

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  try {
    const result = await syncVaultToDb(user!.id);
    return ok({ message: 'Vault synced to database', ...result });
  } catch (e) {
    return err('Sync failed: ' + String(e), 500);
  }
}

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  try {
    const stats = await getVaultStats(user!.id);

    // List actual vault files
    const files: { name: string; path: string; subfolder: string; title: string; tags: string[] }[] = [];
    const dirs = ['notes', 'people', 'projects', 'entities'];

    for (const dir of dirs) {
      const dirPath = path.join(VAULT_PATH, dir);
      try {
        const entries = await fs.readdir(dirPath);
        for (const file of entries) {
          if (!file.endsWith('.md')) continue;
          const filePath = path.join(dirPath, file);
          try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const { data: meta } = matter(raw);
            files.push({
              name: file,
              path: `${dir}/${file}`,
              subfolder: dir,
              title: (meta.title as string) || file.replace('.md', ''),
              tags: (meta.tags as string[]) || [],
            });
          } catch {
            files.push({ name: file, path: `${dir}/${file}`, subfolder: dir, title: file.replace('.md', ''), tags: [] });
          }
        }
      } catch {}
    }

    return ok({ ...stats, files });
  } catch (e) {
    return err('Failed to get vault stats: ' + String(e), 500);
  }
}

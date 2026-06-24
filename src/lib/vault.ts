/**
 * Obsidian Vault Manager
 * 
 * Uses gray-matter (standard library) for YAML frontmatter.
 * Writes pure .md files compatible with Obsidian.
 * PostgreSQL serves as search index; vault is source of truth.
 */

import { query, getMany, getOne } from './db';
import { childLogger } from './logger';
import matter from 'gray-matter';
import * as fs from 'fs/promises';
import * as path from 'path';

const log = childLogger('vault');

const VAULT_PATH = path.join(process.cwd(), 'vault');

// === Helpers ===

function sanitizeFilename(title: string): string {
  return title.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
}

function pickSubfolder(tags: string[]): string {
  if (tags.includes('person') || tags.includes('relationship')) return 'people';
  if (tags.includes('project')) return 'projects';
  if (tags.includes('entity') || tags.includes('organization')) return 'entities';
  return 'notes';
}

// === Core Operations ===

export async function createVaultNote(
  userId: string,
  title: string,
  content: string,
  tags: string[] = [],
  sourceType: string = 'manual',
  metadata: Record<string, unknown> = {}
): Promise<{ id: string; filePath: string }> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const subfolder = pickSubfolder(tags);
  const filePath = path.join(VAULT_PATH, subfolder, sanitizeFilename(title) + '.md');

  log.info({ id, title, filePath, subfolder }, 'createVaultNote called');

  try {
    // gray-matter handles frontmatter serialization
    const fileContent = matter.stringify(content, {
      id,
      title,
      tags,
      source_type: sourceType,
      created: now,
      updated: now,
      ...metadata,
    });

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, fileContent, 'utf-8');
    log.info({ id, title, filePath }, 'Vault note WRITTEN');
  } catch (e) {
    log.error({ err: e, id, title, filePath }, 'Vault note write FAILED');
  }

  // Sync to PostgreSQL (search index)
  await query(
    `INSERT INTO knowledge_notes (id, user_id, title, content, tags, source_type, metadata, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, content=EXCLUDED.content, tags=EXCLUDED.tags, metadata=EXCLUDED.metadata, updated_at=EXCLUDED.updated_at`,
    [id, userId, title, content, tags, sourceType, JSON.stringify(metadata), now, now]
  );

  // Process [[wiki links]]
  await processWikiLinks(id, content, userId);

  return { id, filePath };
}

export async function readVaultNote(noteId: string) {
  return getOne('SELECT * FROM knowledge_notes WHERE id = $1', [noteId]);
}

export async function searchVaultNotes(userId: string, searchQuery: string, tags?: string[]) {
  let sql = `SELECT id, title, content, tags, source_type, metadata, created_at, updated_at
             FROM knowledge_notes WHERE user_id = $1 AND (title ILIKE $2 OR content ILIKE $2)`;
  const params: unknown[] = [userId, `%${searchQuery}%`];
  let idx = 3;

  if (tags && tags.length > 0) {
    sql += ` AND tags && $${idx}`;
    params.push(tags);
    idx++;
  }

  sql += ' ORDER BY updated_at DESC LIMIT 10';
  return getMany(sql, params);
}

export async function listVaultNotes(userId: string, limit = 50) {
  return getMany(
    'SELECT id, title, tags, source_type, created_at FROM knowledge_notes WHERE user_id = $1 ORDER BY updated_at DESC LIMIT $2',
    [userId, limit]
  );
}

export async function updateVaultNote(noteId: string, userId: string, updates: { title?: string; content?: string; tags?: string[] }) {
  const note = await getOne<{ id: string; title: string; content: string; tags: string[] }>(
    'SELECT * FROM knowledge_notes WHERE id = $1 AND user_id = $2', [noteId, userId]
  );
  if (!note) return false;

  const title = updates.title || note.title;
  const content = updates.content || note.content;
  const tags = updates.tags || note.tags;
  const now = new Date().toISOString();

  // Update DB
  await query(
    'UPDATE knowledge_notes SET title=$1, content=$2, tags=$3, updated_at=$4 WHERE id=$5',
    [title, content, tags, now, noteId]
  );

  // Update vault file using gray-matter
  try {
    const subfolder = pickSubfolder(tags);
    const filePath = path.join(VAULT_PATH, subfolder, sanitizeFilename(title) + '.md');
    const fileContent = matter.stringify(content, { id: noteId, title, tags, updated: now });
    await fs.writeFile(filePath, fileContent, 'utf-8');
  } catch (e) {
    log.warn({ err: e, noteId }, 'Failed to update vault file, DB updated');
  }

  return true;
}

export async function deleteVaultNote(noteId: string, userId: string) {
  const note = await getOne<{ title: string; tags: string[] }>(
    'SELECT title, tags FROM knowledge_notes WHERE id = $1 AND user_id = $2', [noteId, userId]
  );
  if (!note) return false;

  await query('DELETE FROM knowledge_notes WHERE id = $1 AND user_id = $2', [noteId, userId]);

  try {
    const subfolder = pickSubfolder(note.tags || []);
    const filePath = path.join(VAULT_PATH, subfolder, sanitizeFilename(note.title) + '.md');
    await fs.unlink(filePath);
  } catch {}

  return true;
}

// === Wiki Links ===

async function processWikiLinks(noteId: string, content: string, userId: string): Promise<number> {
  const linkPattern = /\[\[([^\]]+)\]\]/g;
  let count = 0;
  let match;
  while ((match = linkPattern.exec(content)) !== null) {
    const linkedTitle = match[1].trim();
    const linked = await getOne<{ id: string }>(
      'SELECT id FROM knowledge_notes WHERE user_id = $1 AND title ILIKE $2', [userId, linkedTitle]
    );
    if (linked) {
      await query(
        'INSERT INTO knowledge_links (from_note, to_note, link_type, context) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [noteId, linked.id, 'wiki_link', `[[${linkedTitle}]]`]
      );
      count++;
    }
  }
  return count;
}

// === Sync: Vault → DB ===

export async function syncVaultToDb(userId: string) {
  let imported = 0, updated = 0;
  const dirs = ['notes', 'people', 'projects', 'entities'];

  for (const dir of dirs) {
    const dirPath = path.join(VAULT_PATH, dir);
    try {
      const files = await fs.readdir(dirPath);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(dirPath, file);
        const raw = await fs.readFile(filePath, 'utf-8');
        // gray-matter parses frontmatter
        const { data: meta, content } = matter(raw);

        const id = (meta.id as string) || crypto.randomUUID();
        const title = (meta.title as string) || file.replace('.md', '');
        const tags = (meta.tags as string[]) || [];
        const sourceType = (meta.source_type as string) || 'vault-sync';

        const existing = await getOne<{ id: string }>('SELECT id FROM knowledge_notes WHERE id = $1', [id]);
        if (existing) {
          await query('UPDATE knowledge_notes SET title=$1, content=$2, tags=$3, updated_at=now() WHERE id=$4',
            [title, content, tags, id]);
          updated++;
        } else {
          await query('INSERT INTO knowledge_notes (id, user_id, title, content, tags, source_type) VALUES ($1,$2,$3,$4,$5,$6)',
            [id, userId, title, content, tags, sourceType]);
          imported++;
        }
      }
    } catch {}
  }

  log.info({ imported, updated }, 'Vault synced');
  return { imported, updated };
}

// === Export ===

export async function exportVault(userId: string) {
  const notes = await getMany<{ title: string; content: string; tags: string[] }>(
    'SELECT * FROM knowledge_notes WHERE user_id = $1 ORDER BY updated_at DESC', [userId]
  );

  let md = '# Knowledge Vault\n\n';
  for (const note of notes) {
    const tags = note.tags?.map(t => `#${t}`).join(' ') || '';
    md += `## ${note.title}\n\n`;
    if (tags) md += `**Tags:** ${tags}\n\n`;
    md += `${note.content}\n\n---\n\n`;
  }
  return md;
}

export async function getVaultStats(userId: string) {
  const nc = await getOne<{ count: string }>('SELECT COUNT(*) as count FROM knowledge_notes WHERE user_id=$1', [userId]);
  const lc = await getOne<{ count: string }>(
    `SELECT COUNT(*) as count FROM knowledge_links kl JOIN knowledge_notes kn ON kn.id=kl.from_note WHERE kn.user_id=$1`, [userId]
  );
  const ec = await getOne<{ count: string }>('SELECT COUNT(*) as count FROM knowledge_entities WHERE user_id=$1', [userId]);

  let vaultFiles = 0;
  for (const dir of ['notes', 'people', 'projects', 'entities']) {
    try {
      const files = await fs.readdir(path.join(VAULT_PATH, dir));
      vaultFiles += files.filter(f => f.endsWith('.md')).length;
    } catch {}
  }

  return {
    notes: parseInt(nc?.count || '0'),
    links: parseInt(lc?.count || '0'),
    entities: parseInt(ec?.count || '0'),
    vaultFiles,
  };
}

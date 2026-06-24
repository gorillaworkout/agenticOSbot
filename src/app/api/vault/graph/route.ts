import { authenticateRequest, requireAuth } from '@/lib/auth';
import { ok, err } from '@/lib/api';
import { getMany } from '@/lib/db';

export async function GET(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  try {
    // Get all notes with their tags
    const notes = await getMany<{ id: string; title: string; tags: string[]; source_type: string }>(
      `SELECT id, title, tags, source_type FROM knowledge_notes WHERE user_id = $1 ORDER BY updated_at DESC`,
      [user!.id]
    );

    // Get all links
    const links = await getMany<{ from_note: string; to_note: string; link_type: string }>(
      `SELECT kl.from_note, kl.to_note, kl.link_type 
       FROM knowledge_links kl 
       JOIN knowledge_notes kn ON kn.id = kl.from_note 
       WHERE kn.user_id = $1`,
      [user!.id]
    );

    // Build graph data
    // Blue = user-provided (explicit, manual, remember)
    // Red = system-learned (auto-learn, conversation, vault-sync)
    const nodes = notes.map(n => {
      const isUser = ['explicit', 'manual', 'remember'].includes(n.source_type) || 
                     (n.tags || []).includes('explicit') || 
                     (n.tags || []).includes('remember');
      return {
        id: n.id,
        label: n.title,
        tags: n.tags || [],
        type: n.source_type,
        group: isUser ? 'user' : 'system',
        color: isUser ? '#3b82f6' : '#ef4444', // blue for user, red for system
      };
    });

    const edges = links.map(l => ({
      source: l.from_note,
      target: l.to_note,
      type: l.link_type,
    }));

    return ok({ nodes, edges });
  } catch (e) {
    return err('Failed to load graph: ' + String(e), 500);
  }
}

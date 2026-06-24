/**
 * Learning System — Obsidian-style Knowledge Graph for AgenticOS
 * 
 * Features:
 * - Notes with tags, links, and entities
 * - Auto-learn from conversations
 * - Search & retrieval
 * - Knowledge graph traversal
 */

import { query, getMany, getOne } from './db';
import { createVaultNote, searchVaultNotes, listVaultNotes, updateVaultNote, deleteVaultNote, getVaultStats, exportVault } from './vault';
import { childLogger } from './logger';

const logger = childLogger('learning');

// === Note CRUD ===

export async function createNote(
  userId: string,
  title: string,
  content: string,
  tags: string[] = [],
  sourceType: string = 'manual',
  sourceId?: string,
  metadata: Record<string, unknown> = {}
): Promise<{ id: string; title: string }> {
  const { id } = await createVaultNote(userId, title, content, tags, sourceType, metadata);
  logger.info({ noteId: id, title, tags }, 'Note created (vault)');
  return { id, title };
}

export async function updateNote(
  noteId: string,
  userId: string,
  updates: { title?: string; content?: string; tags?: string[] }
): Promise<boolean> {
  return updateVaultNote(noteId, userId, updates);
}

export async function getNote(noteId: string, userId: string): Promise<Record<string, unknown> | null> {
  const { readVaultNote } = await import('./vault');
  return readVaultNote(noteId);
}

export async function searchNotes(
  userId: string,
  searchQuery: string,
  tags?: string[],
  limit: number = 10
): Promise<Record<string, unknown>[]> {
  return searchVaultNotes(userId, searchQuery, tags);
}

export async function listNotes(
  userId: string,
  limit: number = 50
): Promise<Record<string, unknown>[]> {
  return listVaultNotes(userId, limit);
}

export async function deleteNote(noteId: string, userId: string): Promise<boolean> {
  return deleteVaultNote(noteId, userId);
}

// === Links (Obsidian-style [[wiki links]]) ===

export async function createLink(
  fromNoteId: string,
  toNoteId: string,
  linkType: string = 'related',
  context?: string
): Promise<void> {
  await query(
    `INSERT INTO knowledge_links (from_note, to_note, link_type, context)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [fromNoteId, toNoteId, linkType, context || null]
  );
}

export async function getLinkedNotes(
  noteId: string,
  direction: 'both' | 'outgoing' | 'incoming' = 'both'
): Promise<Record<string, unknown>[]> {
  let sql: string;
  if (direction === 'outgoing') {
    sql = `SELECT kn.*, kl.link_type, kl.context FROM knowledge_links kl
           JOIN knowledge_notes kn ON kn.id = kl.to_note WHERE kl.from_note = $1`;
  } else if (direction === 'incoming') {
    sql = `SELECT kn.*, kl.link_type, kl.context FROM knowledge_links kl
           JOIN knowledge_notes kn ON kn.id = kl.from_note WHERE kl.to_note = $1`;
  } else {
    sql = `SELECT kn.*, kl.link_type, kl.context FROM knowledge_links kl
           JOIN knowledge_notes kn ON (kn.id = kl.to_note OR kn.id = kl.from_note)
           WHERE (kl.from_note = $1 OR kl.to_note = $1) AND kn.id != $1`;
  }
  return getMany<Record<string, unknown>>(sql, [noteId]);
}

// Extract [[wiki links]] from content and auto-create links
export async function processWikiLinks(
  noteId: string,
  content: string,
  userId: string
): Promise<number> {
  const linkPattern = /\[\[([^\]]+)\]\]/g;
  let linkCount = 0;
  let match;

  while ((match = linkPattern.exec(content)) !== null) {
    const linkedTitle = match[1].trim();
    // Find the linked note by title
    const linkedNote = await getOne<{ id: string }>(
      'SELECT id FROM knowledge_notes WHERE user_id = $1 AND title ILIKE $2',
      [userId, linkedTitle]
    );
    if (linkedNote) {
      await createLink(noteId, linkedNote.id, 'wiki_link');
      linkCount++;
    }
  }
  return linkCount;
}

// === Entities (People, Projects, Concepts) ===

export async function createEntity(
  userId: string,
  name: string,
  entityType: string,
  description?: string,
  attributes: Record<string, unknown> = {},
  noteIds: string[] = []
): Promise<{ id: string }> {
  const row = await getOne<{ id: string }>(
    `INSERT INTO knowledge_entities (user_id, name, entity_type, description, attributes, note_ids)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, name, entity_type)
     DO UPDATE SET description = COALESCE(EXCLUDED.description, knowledge_entities.description),
                   attributes = knowledge_entities.attributes || EXCLUDED.attributes,
                   note_ids = array(SELECT DISTINCT unnest(knowledge_entities.note_ids || EXCLUDED.note_ids)),
                   updated_at = now()
     RETURNING id`,
    [userId, name, entityType, description || null, JSON.stringify(attributes), noteIds]
  );
  if (!row) throw new Error('Failed to create entity');
  return row;
}

export async function searchEntities(
  userId: string,
  searchQuery: string,
  entityType?: string
): Promise<Record<string, unknown>[]> {
  let sql = 'SELECT * FROM knowledge_entities WHERE user_id = $1 AND name ILIKE $2';
  const params: unknown[] = [userId, `%${searchQuery}%`];
  if (entityType) {
    sql += ' AND entity_type = $3';
    params.push(entityType);
  }
  sql += ' ORDER BY updated_at DESC LIMIT 10';
  return getMany<Record<string, unknown>>(sql, params);
}

export async function getEntityNotes(
  userId: string,
  entityName: string
): Promise<Record<string, unknown>[]> {
  const entity = await getOne<{ note_ids: string[] }>(
    'SELECT note_ids FROM knowledge_entities WHERE user_id = $1 AND name ILIKE $2',
    [userId, entityName]
  );
  if (!entity || !entity.note_ids?.length) return [];

  return getMany<Record<string, unknown>>(
    'SELECT * FROM knowledge_notes WHERE id = ANY($1) ORDER BY updated_at DESC',
    [entity.note_ids]
  );
}

// === Auto-Learn from Conversation ===

export async function autoLearn(
  userId: string,
  conversationId: string,
  userMessage: string,
  assistantResponse: string
): Promise<{ notesCreated: number; entitiesCreated: number }> {
  let notesCreated = 0;
  let entitiesCreated = 0;

  // Always check for explicit "remember" commands first (regex, fast)
  const rememberMatch = userMessage.match(
    /(?:remember|catat|jangan lupa|ingat|simpan|tolong ingat)[:\s]+(.+)/i
  );
  if (rememberMatch) {
    const content = rememberMatch[1].trim()
      .replace(/^(?:ini[:\s]*)/i, '') // Remove "ini:" prefix
      .trim();
    const cleanTitle = content.length > 50 ? content.slice(0, 50) : content;
    await createNote(
      userId,
      cleanTitle,
      content,
      ['remember', 'explicit'],
      'explicit',
      conversationId
    );
    notesCreated++;
    return { notesCreated, entitiesCreated };
  }

  // For everything else, use LLM to extract memorable information
  try {
    const { chatCompletion } = await import('./llm');

    const extractionPrompt = `You are a memory extraction system. Analyze the following conversation and extract any information worth remembering long-term about the user.

Rules:
- Only extract factual, specific information (not generic chat)
- Extract: personal info, job/company, preferences, instructions, relationships, projects, important context
- Return JSON array of notes: [{"title": "...", "content": "...", "tags": ["tag1", "tag2"]}]
- Return empty array [] if nothing worth remembering
- Be generous — if user shares anything personal, professional, or specific about themselves, extract it
- Tags should be one of: personal, job, preference, instruction, project, relationship, context, definition

User message: "${userMessage.slice(0, 1000)}"
Assistant response: "${assistantResponse.slice(0, 500)}"

Return ONLY a JSON array, no explanation.`;

    const result = await chatCompletion([
      { role: 'system', content: 'You extract memorable facts from conversations. Return only valid JSON.' },
      { role: 'user', content: extractionPrompt }
    ], { temperature: 0.1, maxTokens: 500 });

    // Parse LLM response
    const jsonMatch = result.content.match(/\[[\s\S]*?\]/);
    if (jsonMatch) {
      const extracted = JSON.parse(jsonMatch[0]) as { title: string; content: string; tags: string[] }[];
      for (const item of extracted) {
        if (item.title && item.content) {
          const note = await createNote(
            userId,
            item.title.slice(0, 200),
            item.content,
            item.tags || ['conversation'],
            'auto-learn',
            conversationId,
            { originalMessage: userMessage.slice(0, 500) }
          );
          // Process wiki links in auto-learned content
          if (note.id) {
            try { await processWikiLinks(note.id, item.content, userId); } catch { /* non-fatal */ }
          }
          notesCreated++;
        }
      }
    }

    // Also extract entities via LLM
    const entityPrompt = `Extract named entities from this conversation. Return JSON array: [{"name": "...", "type": "person|organization|project|concept", "description": "..."}]

User: "${userMessage.slice(0, 1000)}"

Return ONLY JSON array.`;

    const entityResult = await chatCompletion([
      { role: 'system', content: 'Extract named entities. Return only valid JSON.' },
      { role: 'user', content: entityPrompt }
    ], { temperature: 0.1, maxTokens: 300 });

    const entityJsonMatch = entityResult.content.match(/\[[\s\S]*?\]/);
    if (entityJsonMatch) {
      const entities = JSON.parse(entityJsonMatch[0]) as { name: string; type: string; description?: string }[];
      for (const ent of entities) {
        if (ent.name && ent.type) {
          await createEntity(userId, ent.name, ent.type, ent.description);
          entitiesCreated++;
        }
      }
    }
  } catch (e) {
    // Fallback: basic regex extraction
    logger.error({ err: e }, 'LLM autoLearn failed, falling back to regex');
    const facts = extractFacts(userMessage);
    for (const fact of facts) {
      await createNote(userId, fact.title, fact.content, fact.tags, 'conversation', conversationId);
      notesCreated++;
    }
    const entities = extractEntities(userMessage);
    for (const ent of entities) {
      await createEntity(userId, ent.name, ent.type, ent.description);
      entitiesCreated++;
    }
  }

  return { notesCreated, entitiesCreated };
}

function extractFacts(message: string): { title: string; content: string; tags: string[] }[] {
  const facts: { title: string; content: string; tags: string[] }[] = [];

  // Detect preferences
  const prefMatch = message.match(/(?:i prefer|i like|aku suka|lebih suka|favorit|favorite)\s+(.+)/i);
  if (prefMatch) {
    facts.push({
      title: `Preference: ${prefMatch[1].slice(0, 50)}`,
      content: prefMatch[1],
      tags: ['preference']
    });
  }

  // Detect instructions
  const instrMatch = message.match(/(?:always|selalu|jangan pernah|never|ingat)\s+(.+)/i);
  if (instrMatch) {
    facts.push({
      title: `Instruction: ${instrMatch[1].slice(0, 50)}`,
      content: instrMatch[1],
      tags: ['instruction']
    });
  }

  // Detect definitions
  const defMatch = message.match(/(.+?)\s+(?:is|adalah|merupakan|berarti)\s+(.+)/i);
  if (defMatch && defMatch[1].length < 50) {
    facts.push({
      title: `Definition: ${defMatch[1]}`,
      content: `${defMatch[1]} = ${defMatch[2]}`,
      tags: ['definition']
    });
  }

  return facts;
}

function extractEntities(message: string): { name: string; type: string; description?: string }[] {
  const entities: { name: string; type: string; description?: string }[] = [];

  // Detect person mentions
  const personMatch = message.match(/(?:my name is|nama saya|nama aku|panggil aku|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (personMatch) {
    entities.push({ name: personMatch[1], type: 'person', description: `Person mentioned: ${personMatch[1]}` });
  }

  // Detect project names (capitalized phrases after "project")
  const projectMatch = message.match(/project\s+([A-Z][a-zA-Z0-9_-]+)/g);
  if (projectMatch) {
    for (const m of projectMatch) {
      const name = m.replace(/project\s+/i, '');
      entities.push({ name, type: 'project' });
    }
  }

  // Detect company/org names
  const orgMatch = message.match(/(?:company|perusahaan|kantor|tempat kerja)\s+(?:adalah\s+)?([A-Z][a-zA-Z\s]+)/i);
  if (orgMatch) {
    entities.push({ name: orgMatch[1].trim(), type: 'organization' });
  }

  return entities;
}

/**
 * Build a user persona string from learned notes + entities.
 * Injected into system prompt so LLM knows user context (GOR-130).
 */
export async function getUserPersona(userId: string): Promise<string> {
  try {
    const notes = await searchVaultNotes(userId, '', ['personal', 'preference', 'instruction', 'job', 'relationship', 'context']);
    const entities = await getMany<{ name: string; entity_type: string; description: string }>(
      'SELECT name, entity_type, description FROM knowledge_entities WHERE user_id = $1 ORDER BY frequency DESC LIMIT 20',
      [userId]
    );

    if ((!notes || notes.length === 0) && (!entities || entities.length === 0)) return '';

    const parts: string[] = [];

    // User preferences & instructions
    const prefs = notes.filter(n => (n.tags as string[])?.includes('preference') || (n.tags as string[])?.includes('instruction'));
    if (prefs.length > 0) {
      parts.push('User preferences/instructions:');
      for (const p of prefs.slice(0, 10)) parts.push(`- ${p.title}: ${p.content}`);
    }

    // Personal info
    const personal = notes.filter(n => (n.tags as string[])?.includes('personal') || (n.tags as string[])?.includes('job'));
    if (personal.length > 0) {
      parts.push('User context:');
      for (const p of personal.slice(0, 10)) parts.push(`- ${p.content}`);
    }

    // Known entities (people, orgs, projects)
    if (entities.length > 0) {
      parts.push('Known entities:');
      for (const e of entities.slice(0, 10)) parts.push(`- ${e.name} (${e.entity_type}): ${e.description || ''}`);
    }

    return parts.join('\n');
  } catch {
    return '';
  }
}

// === Graph Stats ===

export async function getGraphStats(userId: string): Promise<Record<string, unknown>> {
  return getVaultStats(userId);
}

// === Export for Obsidian-style markdown ===

export async function exportToMarkdown(userId: string): Promise<string> {
  return exportVault(userId);
}

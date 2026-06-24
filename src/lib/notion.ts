/**
 * GOR-140: Notion API client.
 * Uses OAuth connection for authenticated requests.
 */
const NOTION_API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

async function notionFetch(path: string, token: string, options?: RequestInit) {
  const res = await fetch(`${NOTION_API}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) return { error: data.message || `Notion API error ${res.status}`, data: null };
  return { error: null, data };
}

export async function searchPages(token: string, query?: string) {
  return notionFetch('/search', token, {
    method: 'POST',
    body: JSON.stringify({
      ...(query && { query }),
      filter: { value: 'page', property: 'object' },
      page_size: 20,
    }),
  });
}

export async function getPage(token: string, pageId: string) {
  return notionFetch(`/pages/${pageId}`, token);
}

export async function createPage(token: string, parentDatabaseId: string, properties: Record<string, unknown>, children?: unknown[]) {
  return notionFetch('/pages', token, {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: parentDatabaseId },
      properties,
      ...(children && { children }),
    }),
  });
}

export async function updatePage(token: string, pageId: string, properties: Record<string, unknown>) {
  return notionFetch(`/pages/${pageId}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ properties }),
  });
}

export async function getBlockChildren(token: string, blockId: string) {
  return notionFetch(`/blocks/${blockId}/children?page_size=100`, token);
}

export async function appendBlocks(token: string, blockId: string, children: unknown[]) {
  return notionFetch(`/blocks/${blockId}/children`, token, {
    method: 'PATCH',
    body: JSON.stringify({ children }),
  });
}

export async function listDatabases(token: string) {
  return notionFetch('/search', token, {
    method: 'POST',
    body: JSON.stringify({
      filter: { value: 'database', property: 'object' },
      page_size: 20,
    }),
  });
}

export async function queryDatabase(token: string, databaseId: string, filter?: unknown, sorts?: unknown[]) {
  const body: Record<string, unknown> = { page_size: 20 };
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;

  return notionFetch(`/databases/${databaseId}/query`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function getCurrentUser(token: string) {
  return notionFetch('/users/me', token);
}

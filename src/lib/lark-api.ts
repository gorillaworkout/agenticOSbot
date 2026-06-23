import { getOne } from '@/lib/db';

const LARK_BASE = 'https://open.larksuite.com/open-apis';

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function getLarkToken(appId?: string): Promise<string> {
  const cacheKey = appId || 'default';
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  let config: { app_id: string; app_secret: string } | null = null;
  if (appId) {
    config = await getOne<{ app_id: string; app_secret: string }>(
      'SELECT app_id, app_secret FROM lark_config WHERE app_id = $1 AND enabled = true', [appId]
    );
  } else {
    config = await getOne<{ app_id: string; app_secret: string }>(
      'SELECT app_id, app_secret FROM lark_config WHERE enabled = true LIMIT 1'
    );
  }
  if (!config) throw new Error('Lark config not found');

  const res = await fetch(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: config.app_id, app_secret: config.app_secret }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg || 'Failed to get Lark token');
  const token = data.tenant_access_token;
  const expiresAt = Date.now() + (data.expire - 300) * 1000;
  tokenCache.set(cacheKey, { token, expiresAt });
  return token;
}

// User access token for per-user API calls (calendar, docs, etc.)
export async function getLarkUserToken(userId: string, appId: string): Promise<string | null> {
  const row = await getOne<{ access_token: string; refresh_token: string; expires_at: Date }>(
    'SELECT access_token, refresh_token, expires_at FROM lark_user_tokens WHERE user_id = $1 AND app_id = $2',
    [userId, appId]
  );
  if (!row) return null;

  // If expired, try to refresh
  if (new Date(row.expires_at) < new Date()) {
    const config = await getOne<{ app_secret: string }>(
      'SELECT app_secret FROM lark_config WHERE app_id = $1', [appId]
    );
    if (!config || !row.refresh_token) return null;

    try {
      const res = await fetch(`${LARK_BASE}/authen/v2/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: appId,
          client_secret: config.app_secret,
          refresh_token: row.refresh_token,
        }),
      });
      const data = await res.json();
      if (data.code !== 0) throw new Error(data.msg);

      const expiresAt = new Date(Date.now() + data.data.expires_in * 1000);
      await getOne(
        `UPDATE lark_user_tokens SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = now() WHERE user_id = $4 AND app_id = $5`,
        [data.data.access_token, data.data.refresh_token, expiresAt, userId, appId]
      ).catch(() => null);
      return data.data.access_token;
    } catch {
      return null;
    }
  }

  return row.access_token;
}

async function larkFetch(path: string, options: RequestInit = {}, userToken?: string, appId?: string): Promise<unknown> {
  const token = userToken || await getLarkToken(appId);
  const res = await fetch(`${LARK_BASE}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg || `Lark API error: ${data.code}`);
  return data.data;
}

// Bitable APIs
export async function larkBitableListApps(): Promise<unknown> {
  return larkFetch('/bitable/v1/apps?page_size=100');
}

export async function larkBitableListTables(appToken: string): Promise<unknown> {
  return larkFetch(`/bitable/v1/apps/${appToken}/tables?page_size=100`);
}

export async function larkBitableListFields(appToken: string, tableId: string): Promise<unknown> {
  return larkFetch(`/bitable/v1/apps/${appToken}/tables/${tableId}/fields?page_size=100`);
}

export async function larkBitableListRecords(
  appToken: string, tableId: string, filter?: string, pageToken?: string, pageSize?: number
): Promise<unknown> {
  const params = new URLSearchParams({ page_size: String(pageSize || 20) });
  if (filter) params.set('filter', filter);
  if (pageToken) params.set('page_token', pageToken);
  return larkFetch(`/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`);
}

export async function larkBitableGetRecord(appToken: string, tableId: string, recordId: string): Promise<unknown> {
  return larkFetch(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`);
}

export async function larkBitableCreateRecord(appToken: string, tableId: string, fields: Record<string, unknown>): Promise<unknown> {
  return larkFetch(`/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
    method: 'POST', body: JSON.stringify({ fields }),
  });
}

export async function larkBitableUpdateRecord(appToken: string, tableId: string, recordId: string, fields: Record<string, unknown>): Promise<unknown> {
  return larkFetch(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
    method: 'PUT', body: JSON.stringify({ fields }),
  });
}

export async function larkBitableDeleteRecord(appToken: string, tableId: string, recordId: string): Promise<unknown> {
  return larkFetch(`/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
    method: 'DELETE',
  });
}

// Calendar APIs
export async function larkCalendarListCalendars(): Promise<unknown> {
  return larkFetch('/calendar/v4/calendars?page_size=50');
}

export async function larkCalendarListEvents(
  calendarId: string, startTime?: string, endTime?: string, userToken?: string, pageToken?: string
): Promise<unknown> {
  const params = new URLSearchParams({ page_size: '50' });
  if (startTime) params.set('start_time', String(Math.floor(new Date(startTime).getTime() / 1000)));
  if (endTime) params.set('end_time', String(Math.floor(new Date(endTime).getTime() / 1000)));
  if (pageToken) params.set('page_token', pageToken);
  return larkFetch(`/calendar/v4/calendars/${calendarId}/events?${params}`, undefined, userToken);
}

export async function larkCalendarCreateEvent(
  calendarId: string, summary: string, startTime: string, endTime: string,
  description?: string, attendees?: string[], location?: string
): Promise<unknown> {
  const body: Record<string, unknown> = {
    summary,
    start_time: { timestamp: startTime },
    end_time: { timestamp: endTime },
  };
  if (description) body.description = description;
  if (location) body.location = { name: location };
  if (attendees?.length) {
    body.attendees = attendees.map(a => ({ type: 'user', user_id: a }));
  }
  return larkFetch(`/calendar/v4/calendars/${calendarId}/events`, {
    method: 'POST', body: JSON.stringify(body),
  });
}

// Approval APIs
export async function larkApprovalListInstances(approvalCode?: string, pageSize?: number, pageToken?: string): Promise<unknown> {
  const params = new URLSearchParams({ page_size: String(pageSize || 20) });
  if (approvalCode) params.set('approval_code', approvalCode);
  if (pageToken) params.set('page_token', pageToken);
  return larkFetch(`/approval/v4/instances?${params}`);
}

export async function larkApprovalGetInstance(instanceId: string): Promise<unknown> {
  return larkFetch(`/approval/v4/instances/${instanceId}`);
}

export async function larkApprovalApprove(instanceId: string, userId: string, comment?: string): Promise<unknown> {
  return larkFetch(`/approval/v4/instances/${instanceId}/approve`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, comment: comment || '' }),
  });
}

export async function larkApprovalReject(instanceId: string, userId: string, comment?: string): Promise<unknown> {
  return larkFetch(`/approval/v4/instances/${instanceId}/reject`, {
    method: 'POST',
    body: JSON.stringify({ user_id: userId, comment: comment || '' }),
  });
}

// === Direct API functions for multi-app support ===
export async function larkContactSearchUser(query: string, appId?: string): Promise<unknown> {
  const token = await getLarkToken(appId);
  const res = await fetch(`${LARK_BASE}/search/v1/user?query=${encodeURIComponent(query)}&page_size=20`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg || 'Search user failed');
  return data.data;
}

export async function larkCalendarListCalendarsForApp(appId?: string): Promise<unknown> {
  return larkFetch('/calendar/v4/calendars', {}, undefined, appId);
}

export async function larkCalendarListEventsForApp(calendarId: string, startTime: string, endTime: string, appId?: string): Promise<unknown> {
  return larkFetch(`/calendar/v4/calendars/${calendarId}/events?start_time=${startTime}&end_time=${endTime}`, {}, undefined, appId);
}

export async function larkCalendarCreateEventForApp(
  calendarId: string, summary: string, startTime: string, endTime: string,
  description?: string, attendeeIds?: string[], appId?: string
): Promise<unknown> {
  const body: Record<string, unknown> = {
    summary,
    start_time: { timestamp: startTime },
    end_time: { timestamp: endTime },
  };
  if (description) body.description = description;
  if (attendeeIds?.length) {
    body.attendees = attendeeIds.map(id => ({ type: 'user', user_id: id }));
  }
  return larkFetch(`/calendar/v4/calendars/${calendarId}/events`, {
    method: 'POST', body: JSON.stringify(body),
  }, undefined, appId);
}

export async function larkCalendarUpdateEventForApp(
  calendarId: string, eventId: string, updates: Record<string, unknown>, appId?: string
): Promise<unknown> {
  return larkFetch(`/calendar/v4/calendars/${calendarId}/events/${eventId}`, {
    method: 'PATCH', body: JSON.stringify(updates),
  }, undefined, appId);
}

export async function larkCalendarDeleteEventForApp(calendarId: string, eventId: string, appId?: string): Promise<unknown> {
  return larkFetch(`/calendar/v4/calendars/${calendarId}/events/${eventId}`, {
    method: 'DELETE',
  }, undefined, appId);
}

// === Multi-app user token support ===
export async function getLarkUserTokenFromDB(appId?: string): Promise<string | null> {
  const row = await getOne<{ access_token: string; refresh_token: string; expires_at: Date }>(
    'SELECT access_token, refresh_token, expires_at FROM lark_user_tokens WHERE app_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [appId || '']
  );
  if (!row) return null;
  // lark-cli-managed tokens are markers — tools should use lark-cli directly
  if (row.access_token === 'lark-cli-managed') return '__USE_LARK_CLI__';

  // If expired, try to refresh
  if (new Date(row.expires_at) < new Date()) {
    if (!row.refresh_token) return null;
    const config = await getOne<{ app_id: string; app_secret: string }>(
      'SELECT app_id, app_secret FROM lark_config WHERE app_id = $1', [appId]
    );
    if (!config) return null;

    try {
      const res = await fetch(`${LARK_BASE}/authen/v2/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: config.app_id,
          client_secret: config.app_secret,
          refresh_token: row.refresh_token,
        }),
      });
      const data = await res.json();
      if (data.code !== 0) return null;

      const expiresAt = new Date(Date.now() + data.data.expires_in * 1000);
      await getOne(
        `UPDATE lark_user_tokens SET access_token = $1, refresh_token = $2, expires_at = $3, updated_at = now() WHERE app_id = $4`,
        [data.data.access_token, data.data.refresh_token, expiresAt, appId]
      ).catch(() => null);
      return data.data.access_token;
    } catch {
      return null;
    }
  }

  return row.access_token;
}

// === Docs (Docx) APIs ===

export async function larkDocsGetContent(documentId: string): Promise<unknown> {
  return larkFetch(`/docx/v1/documents/${documentId}/raw_content`);
}

export async function larkDocsGetBlocks(documentId: string, pageToken?: string): Promise<unknown> {
  const params = new URLSearchParams({ page_size: '500' });
  if (pageToken) params.set('page_token', pageToken);
  return larkFetch(`/docx/v1/documents/${documentId}/blocks?${params}`);
}

export async function larkDocsCreate(title: string, folderToken?: string): Promise<unknown> {
  const body: Record<string, unknown> = { title };
  if (folderToken) body.folder_token = folderToken;
  return larkFetch('/docx/v1/documents', {
    method: 'POST', body: JSON.stringify(body),
  });
}

export async function larkDocsCreateBlock(documentId: string, blockId: string, children: Array<Record<string, unknown>>): Promise<unknown> {
  return larkFetch(`/docx/v1/documents/${documentId}/blocks/${blockId}/children`, {
    method: 'POST', body: JSON.stringify({ children, index: 0 }),
  });
}

export async function larkDocsUpdateBlock(documentId: string, blockId: string, update: Record<string, unknown>): Promise<unknown> {
  return larkFetch(`/docx/v1/documents/${documentId}/blocks/${blockId}`, {
    method: 'PATCH', body: JSON.stringify(update),
  });
}

export async function larkDocsDeleteBlock(documentId: string, blockId: string): Promise<unknown> {
  return larkFetch(`/docx/v1/documents/${documentId}/blocks/${blockId}/children/batch_delete`, {
    method: 'DELETE', body: JSON.stringify({ start_index: 0, end_index: -1 }),
  });
}

// === Wiki APIs ===

export async function larkWikiListSpaces(pageToken?: string): Promise<unknown> {
  const params = new URLSearchParams({ page_size: '50' });
  if (pageToken) params.set('page_token', pageToken);
  return larkFetch(`/wiki/v2/spaces?${params}`);
}

export async function larkWikiGetNode(token: string): Promise<unknown> {
  return larkFetch(`/wiki/v2/spaces/get_node?token=${encodeURIComponent(token)}`);
}

export async function larkWikiListNodes(spaceId: string, parentNodeToken?: string, pageToken?: string): Promise<unknown> {
  const params = new URLSearchParams({ page_size: '50' });
  if (parentNodeToken) params.set('parent_node_token', parentNodeToken);
  if (pageToken) params.set('page_token', pageToken);
  return larkFetch(`/wiki/v2/spaces/${spaceId}/nodes?${params}`);
}

// === lark-cli fallback for getting user token ===
export async function getLarkUserTokenFromDBOrCLI(appId?: string): Promise<string | null> {
  // Try DB first
  const dbToken = await getLarkUserTokenFromDB(appId);
  if (dbToken) return dbToken;

  // Fallback: try lark-cli (only works for the app that's currently logged in)
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    // Use lark-cli to make API call which internally uses its stored user token
    // We'll extract the token by making a lightweight API call
    const { stdout } = await execAsync('lark-cli api GET /authen/v1/user_info --as user --json', {
      cwd: '/home/ubuntu/apps/agentic-os',
    });
    const result = JSON.parse(stdout);
    if (result.code === 0) {
      // lark-cli works but we can't extract the raw token
      // Return a marker that tells tools to use lark-cli
      return '__USE_LARK_CLI__';
    }
  } catch {}
  return null;
}

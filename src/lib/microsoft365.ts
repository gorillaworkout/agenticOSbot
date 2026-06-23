import { getOne } from '@/lib/db';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

interface Ms365TokenCache {
  token: string;
  expiresAt: number;
  userId: string;
}

let tokenCache: Ms365TokenCache | null = null;

interface Ms365Config {
  id: string;
  tenant_id: string;
  client_id: string;
  client_secret_encrypted: string;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: Date | null;
  scopes: string[] | null;
}

async function getConfig(userId: string): Promise<Ms365Config> {
  const config = await getOne<Ms365Config>(
    'SELECT * FROM ms365_config WHERE user_id = $1 LIMIT 1', [userId]
  );
  if (!config) throw new Error('Microsoft 365 not configured. Please set up MS365 config first.');
  return config;
}

async function getMs365Token(userId: string): Promise<string> {
  if (tokenCache && tokenCache.userId === userId && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const config = await getConfig(userId);
  if (config.access_token && config.token_expires_at && new Date(config.token_expires_at) > new Date()) {
    tokenCache = { token: config.access_token, expiresAt: new Date(config.token_expires_at).getTime(), userId };
    return config.access_token;
  }

  // Refresh token
  if (config.refresh_token) {
    return refreshMs365Token(userId, config);
  }

  throw new Error('Microsoft 365 token expired. Please re-authenticate.');
}

async function refreshMs365Token(userId: string, config?: Ms365Config): Promise<string> {
  if (!config) config = await getConfig(userId);
  if (!config.refresh_token) throw new Error('No refresh token. Please re-authenticate.');

  const tokenUrl = `https://login.microsoftonline.com/${config.tenant_id}/oauth2/v2.0/token`;
  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.client_id,
      client_secret: config.client_secret_encrypted, // stored as-is for now
      refresh_token: config.refresh_token,
      grant_type: 'refresh_token',
      scope: config.scopes?.join(' ') || 'Calendars.ReadWrite Mail.Send Files.ReadWrite',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(data.error_description || 'Token refresh failed');

  const expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000);
  await import('@/lib/db').then(m => m.query(
    'UPDATE ms365_config SET access_token = $1, refresh_token = $2, token_expires_at = $3, updated_at = now() WHERE user_id = $4',
    [data.access_token, data.refresh_token || config.refresh_token, expiresAt, userId]
  ));

  tokenCache = { token: data.access_token, expiresAt: expiresAt.getTime(), userId };
  return data.access_token;
}

async function graphFetch(path: string, options: RequestInit = {}, userId?: string): Promise<unknown> {
  const token = await getMs365Token(userId || '');
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...options.headers },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Graph API error ${res.status}: ${err}`);
  }
  return res.json();
}

// Email
export async function ms365SendEmail(userId: string, to: string, subject: string, body: string, isHtml = true): Promise<unknown> {
  return graphFetch('/me/sendMail', {
    method: 'POST',
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: isHtml ? 'HTML' : 'Text', content: body },
        toRecipients: [{ emailAddress: { address: to } }],
      },
    }),
  }, userId);
}

export async function ms365ListEmails(userId: string, folder?: string, top = 10, filter?: string): Promise<unknown> {
  const path = folder ? `/me/mailFolders/${folder}/messages` : '/me/messages';
  const params = new URLSearchParams({ '$top': String(top), '$orderby': 'receivedDateTime desc' });
  if (filter) params.set('$filter', filter);
  return graphFetch(`${path}?${params}`, {}, userId);
}

export async function ms365GetEmail(userId: string, messageId: string): Promise<unknown> {
  return graphFetch(`/me/messages/${messageId}`, {}, userId);
}

// Calendar
export async function ms365ListCalendars(userId: string): Promise<unknown> {
  return graphFetch('/me/calendars', {}, userId);
}

export async function ms365ListEvents(userId: string, calendarId?: string, startDateTime?: string, endDateTime?: string): Promise<unknown> {
  const base = calendarId ? `/me/calendars/${calendarId}/events` : '/me/events';
  const params = new URLSearchParams();
  if (startDateTime) params.set('startDateTime', startDateTime);
  if (endDateTime) params.set('endDateTime', endDateTime);
  params.set('$orderby', 'start/dateTime');
  const qs = params.toString() ? `?${params}` : '';
  return graphFetch(`${base}${qs}`, {}, userId);
}

export async function ms365CreateEvent(
  userId: string, subject: string, start: string, end: string,
  body?: string, attendees?: string[], location?: string
): Promise<unknown> {
  const event: Record<string, unknown> = {
    subject,
    start: { dateTime: start, timeZone: 'Asia/Jakarta' },
    end: { dateTime: end, timeZone: 'Asia/Jakarta' },
  };
  if (body) event.body = { contentType: 'Text', content: body };
  if (attendees?.length) event.attendees = attendees.map(a => ({ emailAddress: { address: a }, type: 'required' }));
  if (location) event.location = { displayName: location };
  return graphFetch('/me/events', { method: 'POST', body: JSON.stringify(event) }, userId);
}

// OneDrive
export async function ms365ListFiles(userId: string, folderId?: string): Promise<unknown> {
  const path = folderId ? `/me/drive/items/${folderId}/children` : '/me/drive/root/children';
  return graphFetch(`${path}?$top=50`, {}, userId);
}

export async function ms365UploadFile(userId: string, folderId: string, fileName: string, content: string): Promise<unknown> {
  const res = await graphFetch(
    `/me/drive/items/${folderId}:/${fileName}:/content`,
    { method: 'PUT', body: content, headers: { 'Content-Type': 'application/octet-stream' } },
    userId
  );
  return res;
}

export async function ms365CreateFolder(userId: string, parentId: string, name: string): Promise<unknown> {
  return graphFetch(`/me/drive/items/${parentId}/children`, {
    method: 'POST',
    body: JSON.stringify({ name, folder: {} }),
  }, userId);
}

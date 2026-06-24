import { childLogger } from './logger';
import { getOne, query } from './db';

const log = childLogger('lark');

const LARK_BASE = 'https://open.larksuite.com/open-apis';

interface LarkTokenResponse {
  code: number;
  msg: string;
  tenant_access_token: string;
  expire: number;
}

// Cache tokens per app_id
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
  const cached = tokenCache.get(appId);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await fetch(`${LARK_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data: LarkTokenResponse = await res.json();
  if (data.code !== 0) throw new Error(`Lark auth error: ${data.msg}`);

  const token = data.tenant_access_token;
  tokenCache.set(appId, { token, expiresAt: Date.now() + (data.expire - 60) * 1000 });
  return token;
}

export async function sendLarkMessage(
  appId: string,
  appSecret: string,
  receiveId: string,
  msgType: 'text' | 'interactive',
  content: string,
  receiveIdType: 'open_id' | 'user_id' | 'chat_id' = 'open_id',
  replyToMessageId?: string // GOR-124: thread reply support
): Promise<{ ok: boolean; message_id?: string; error?: string }> {
  try {
    const token = await getTenantAccessToken(appId, appSecret);
    const url = replyToMessageId
      ? `${LARK_BASE}/im/v1/messages/${replyToMessageId}/reply`
      : `${LARK_BASE}/im/v1/messages?receive_id_type=${receiveIdType}`;
    const body: Record<string, unknown> = replyToMessageId
      ? { msg_type: msgType, content }
      : { receive_id: receiveId, msg_type: msgType, content };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (data.code !== 0) return { ok: false, error: data.msg };
    return { ok: true, message_id: data.data?.message_id };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Update an existing Lark message in-place (e.g. replace loading card with final card).
 * Only supports updating msg_type=interactive (cards).
 */
export async function updateLarkMessage(
  appId: string,
  appSecret: string,
  messageId: string,
  content: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getTenantAccessToken(appId, appSecret);
    const res = await fetch(`${LARK_BASE}/im/v1/messages/${messageId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ content }),
    });
    const data = await res.json();
    if (data.code !== 0) return { ok: false, error: data.msg };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

/**
 * Download a file or media resource from Lark by message_id + file_key.
 * Returns raw bytes + content-type.
 */
export async function downloadLarkFile(
  appId: string,
  appSecret: string,
  messageId: string,
  fileKey: string,
  messageType: 'file' | 'image' | 'media' = 'file'
): Promise<{ ok: boolean; buffer?: Buffer; contentType?: string; fileName?: string; error?: string }> {
  try {
    const token = await getTenantAccessToken(appId, appSecret);
    const endpoint = messageType === 'image'
      ? `${LARK_BASE}/im/v1/images/${fileKey}`
      : `${LARK_BASE}/im/v1/messages/${messageId}/resources/${fileKey}?type=${messageType}`;
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const errText = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${errText}` };
    }
    const contentType = res.headers.get('content-type') || 'application/octet-stream';
    const contentDisp = res.headers.get('content-disposition') || '';
    const fileNameMatch = contentDisp.match(/filename\*?="?([^";]+)/i);
    const fileName = fileNameMatch ? decodeURIComponent(fileNameMatch[1]) : undefined;
    const arrayBuf = await res.arrayBuffer();
    return { ok: true, buffer: Buffer.from(arrayBuf), contentType, fileName };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export async function getLarkUserInfo(
  appId: string,
  appSecret: string,
  userId: string,
  userIdType: 'open_id' | 'user_id' | 'union_id' = 'open_id'
): Promise<Record<string, unknown> | null> {
  try {
    const token = await getTenantAccessToken(appId, appSecret);
    const res = await fetch(`${LARK_BASE}/contact/v3/users/${userId}?user_id_type=${userIdType}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.code !== 0) return null;
    return data.data?.user || null;
  } catch {
    return null;
  }
}

export interface LarkEvent {
  schema?: string;
  header?: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event?: Record<string, unknown>;
  challenge?: string; // for URL verification
  type?: string; // url_verification event type
}

// Encrypted event payload from Lark (when using Verification Token in dev console)
interface EncryptedPayload {
  encrypt: string; // base64-encoded AES-256-ECB encrypted JSON
}

// Decrypt Lark encrypted event payload (AES-256-ECB with Verification Token as key)
export function decryptLarkEvent(encrypted: string): string {
  const key = process.env.LARK_ENCRYPT_KEY || process.env.LARK_VERIFICATION_TOKEN || '';
  if (!key) throw new Error('LARK_ENCRYPT_KEY not configured');
  // AES-256-ECB requires 32-byte key
  const keyBuf = Buffer.from(key.padEnd(32, '0').slice(0, 32), 'utf8');
  const encBuf = Buffer.from(encrypted, 'base64');
  // Use Node crypto (sync decryption)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const crypto = require('crypto') as typeof import('crypto');
  const decipher = crypto.createDecipheriv('aes-256-ecb', keyBuf, null);
  decipher.setAutoPadding(true);
  let dec = decipher.update(encBuf);
  dec = Buffer.concat([dec, decipher.final()]);
  return dec.toString('utf8');
}

export function parseLarkEvent(body: unknown): LarkEvent {
  // Handle encrypted payload: { encrypt: 'base64...' }
  if (body && typeof body === 'object' && 'encrypt' in (body as Record<string, unknown>)) {
    const enc = (body as EncryptedPayload).encrypt;
    if (!enc) return body as LarkEvent;
    try {
      const decrypted = decryptLarkEvent(enc);
      log.debug({ decrypted: decrypted.slice(0, 200) }, 'Decrypted Lark event');
      return JSON.parse(decrypted) as LarkEvent;
    } catch (e) {
      log.error({ err: e }, 'Failed to decrypt Lark event');
      return body as LarkEvent;
    }
  }
  return body as LarkEvent;
}

// GOR-125: Emoji reaction as instant acknowledgement
export async function addLarkReaction(
  appId: string,
  appSecret: string,
  messageId: string,
  emojiType: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getTenantAccessToken(appId, appSecret);
    const res = await fetch(`https://open.larksuite.com/open-apis/im/v1/messages/${messageId}/reactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ reaction_type: { emoji_type: emojiType } }),
    });
    const data = await res.json();
    if (data.code !== 0) return { ok: false, error: data.msg };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export async function removeLarkReaction(
  appId: string,
  appSecret: string,
  messageId: string,
  reactionId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    const token = await getTenantAccessToken(appId, appSecret);
    const res = await fetch(`https://open.larksuite.com/open-apis/im/v1/messages/${messageId}/reactions/${reactionId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    });
    const data = await res.json();
    if (data.code !== 0) return { ok: false, error: data.msg };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

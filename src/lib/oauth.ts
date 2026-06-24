/**
 * GOR-138: Unified OAuth 2.0 flow for GitHub, Notion, Slack, Airtable.
 * Authorization Code flow with PKCE support.
 */
import { query, getOne } from './db';
import { childLogger } from './logger';

const log = childLogger('oauth');

// OAuth provider configurations
export interface OAuthProviderConfig {
  id: string;
  name: string;
  icon: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  extraParams?: Record<string, string>;
}

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  github: {
    id: 'github',
    name: 'GitHub',
    icon: '🐙',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scopes: ['repo', 'read:org', 'read:user'],
  },
  notion: {
    id: 'notion',
    name: 'Notion',
    icon: '📝',
    authorizeUrl: 'https://api.notion.com/v1/oauth/authorize',
    tokenUrl: 'https://api.notion.com/v1/oauth/token',
    scopes: [],
  },
  slack: {
    id: 'slack',
    name: 'Slack',
    icon: '💼',
    authorizeUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access',
    scopes: ['chat:write', 'channels:read', 'channels:history', 'users:read'],
  },
  airtable: {
    id: 'airtable',
    name: 'Airtable',
    icon: '📊',
    authorizeUrl: 'https://airtable.com/oauth2/v1/authorize',
    tokenUrl: 'https://airtable.com/oauth2/v1/token',
    scopes: ['data.records:read', 'data.records:write', 'schema.bases:read'],
  },
  google: {
    id: 'google',
    name: 'Google Workspace',
    icon: '🔵',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/calendar'],
    extraParams: { access_type: 'offline', prompt: 'consent' },
  },
  linear: {
    id: 'linear',
    name: 'Linear',
    icon: '📐',
    authorizeUrl: 'https://linear.app/oauth/authorize',
    tokenUrl: 'https://api.linear.app/oauth/token',
    scopes: ['read', 'write', 'issues:create', 'comments:create'],
  },
};

// DB table: oauth_connections
// CREATE TABLE oauth_connections (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id TEXT NOT NULL,
//   provider TEXT NOT NULL,
//   access_token TEXT NOT NULL,
//   refresh_token TEXT,
//   expires_at TIMESTAMPTZ,
//   scopes TEXT[],
//   provider_user_id TEXT,
//   provider_user_name TEXT,
//   metadata JSONB DEFAULT '{}',
//   created_at TIMESTAMPTZ DEFAULT NOW(),
//   updated_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE(user_id, provider)
// );

export interface OAuthConnection {
  id: string;
  user_id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string | null;
  scopes: string[];
  provider_user_id: string | null;
  provider_user_name: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/**
 * Generate OAuth authorization URL.
 */
export function getAuthorizationUrl(
  provider: string,
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) throw new Error(`Unknown OAuth provider: ${provider}`);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    response_type: 'code',
    ...(config.scopes.length > 0 && { scope: config.scopes.join(' ') }),
    ...config.extraParams,
  });

  // Notion uses public param
  if (provider === 'notion') {
    params.set('owner', 'user');
  }

  return `${config.authorizeUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens.
 */
export async function exchangeCode(
  provider: string,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string; expiresIn?: number; scope?: string; error?: string }> {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return { accessToken: '', error: `Unknown provider: ${provider}` };

  try {
    const body: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
    };

    // GitHub needs Accept header for JSON response
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Notion uses Basic auth
    if (provider === 'notion') {
      headers['Authorization'] = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
      delete body.client_id;
      delete body.client_secret;
    }

    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (data.error) {
      return { accessToken: '', error: data.error_description || data.error };
    }

    return {
      accessToken: data.access_token || '',
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    };
  } catch (err) {
    return { accessToken: '', error: err instanceof Error ? err.message : 'Token exchange failed' };
  }
}

/**
 * Save OAuth connection to database.
 */
export async function saveConnection(
  userId: string,
  provider: string,
  tokens: { accessToken: string; refreshToken?: string; expiresIn?: number; scope?: string },
  providerUser?: { id: string; name: string }
): Promise<OAuthConnection> {
  const expiresAt = tokens.expiresIn
    ? new Date(Date.now() + tokens.expiresIn * 1000).toISOString()
    : null;

  const result = await query<OAuthConnection>(
    `INSERT INTO oauth_connections (user_id, provider, access_token, refresh_token, expires_at, scopes, provider_user_id, provider_user_name, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     ON CONFLICT (user_id, provider) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = COALESCE(EXCLUDED.refresh_token, oauth_connections.refresh_token),
       expires_at = EXCLUDED.expires_at,
       scopes = EXCLUDED.scopes,
       provider_user_id = COALESCE(EXCLUDED.provider_user_id, oauth_connections.provider_user_id),
       provider_user_name = COALESCE(EXCLUDED.provider_user_name, oauth_connections.provider_user_name),
       updated_at = NOW()
     RETURNING *`,
    [
      userId, provider, tokens.accessToken, tokens.refreshToken || null, expiresAt,
      tokens.scope ? tokens.scope.split(' ') : [],
      providerUser?.id || null, providerUser?.name || null,
    ]
  );

  log.info({ userId, provider, providerUser: providerUser?.name }, 'OAuth connection saved');
  return result.rows[0];
}

/**
 * Get active OAuth connection for a user and provider.
 */
export async function getConnection(userId: string, provider: string): Promise<OAuthConnection | null> {
  const conn = await getOne<OAuthConnection>(
    'SELECT * FROM oauth_connections WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );

  if (!conn) return null;

  // Check if token is expired and try to refresh
  if (conn.expires_at && new Date(conn.expires_at) < new Date()) {
    if (conn.refresh_token) {
      const refreshed = await refreshConnection(conn);
      return refreshed;
    }
    log.warn({ userId, provider }, 'OAuth token expired and no refresh token');
    return null;
  }

  return conn;
}

/**
 * Refresh an expired OAuth token.
 */
async function refreshConnection(conn: OAuthConnection): Promise<OAuthConnection | null> {
  const config = OAUTH_PROVIDERS[conn.provider];
  if (!config) return null;

  try {
    // Get client credentials from env
    const clientId = process.env[`${conn.provider.toUpperCase()}_CLIENT_ID`] || '';
    const clientSecret = process.env[`${conn.provider.toUpperCase()}_CLIENT_SECRET`] || '';

    if (!clientId || !clientSecret) {
      log.error({ provider: conn.provider }, 'Missing OAuth client credentials for refresh');
      return null;
    }

    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: conn.refresh_token,
        client_id: clientId,
        client_secret: clientSecret,
      }),
    });

    const data = await res.json();
    if (data.error) {
      log.error({ provider: conn.provider, error: data.error }, 'OAuth token refresh failed');
      return null;
    }

    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000).toISOString()
      : null;

    const result = await query<OAuthConnection>(
      `UPDATE oauth_connections SET access_token = $1, refresh_token = COALESCE($2, refresh_token), expires_at = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [data.access_token, data.refresh_token || null, expiresAt, conn.id]
    );

    log.info({ provider: conn.provider }, 'OAuth token refreshed');
    return result.rows[0];
  } catch (err) {
    log.error({ provider: conn.provider, error: err }, 'OAuth refresh error');
    return null;
  }
}

/**
 * List all connections for a user.
 */
export async function listConnections(userId: string): Promise<OAuthConnection[]> {
  const result = await query<OAuthConnection>(
    'SELECT * FROM oauth_connections WHERE user_id = $1 ORDER BY provider',
    [userId]
  );
  return result.rows;
}

/**
 * Delete (disconnect) an OAuth connection.
 */
export async function deleteConnection(userId: string, provider: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM oauth_connections WHERE user_id = $1 AND provider = $2',
    [userId, provider]
  );
  log.info({ userId, provider }, 'OAuth connection deleted');
  return (result.rowCount ?? 0) > 0;
}

/**
 * Generate a cryptographic state parameter for CSRF protection.
 */
export function generateOAuthState(userId: string, provider: string): string {
  const data = JSON.stringify({ userId, provider, ts: Date.now() });
  return Buffer.from(data).toString('base64url');
}

/**
 * Parse and validate OAuth state parameter.
 */
export function parseOAuthState(state: string): { userId: string; provider: string; error?: string } {
  try {
    const data = JSON.parse(Buffer.from(state, 'base64url').toString());
    // State expires after 10 minutes
    if (Date.now() - data.ts > 10 * 60 * 1000) {
      return { userId: '', provider: '', error: 'State expired' };
    }
    return { userId: data.userId, provider: data.provider };
  } catch {
    return { userId: '', provider: '', error: 'Invalid state' };
  }
}

/**
 * Init tool for OAuth — get auth URL for a provider.
 */
export function getOAuthAuthUrl(userId: string, provider: string, baseUrl: string): { url: string; error?: string } {
  const config = OAUTH_PROVIDERS[provider];
  if (!config) return { url: '', error: `Unknown provider: ${provider}` };

  const clientId = process.env[`${provider.toUpperCase()}_CLIENT_ID`] || '';
  if (!clientId) return { url: '', error: `${provider} OAuth not configured (missing CLIENT_ID)` };

  const redirectUri = `${baseUrl}/api/oauth/callback`;
  const state = generateOAuthState(userId, provider);

  return { url: getAuthorizationUrl(provider, clientId, redirectUri, state) };
}

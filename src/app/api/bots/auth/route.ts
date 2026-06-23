import { ok, err } from '@/lib/api';
import { query, getOne } from '@/lib/db';
import { childLogger } from '@/lib/logger';
import { exec } from 'child_process';
import { promisify } from 'util';

const log = childLogger('api:bots:auth');
const execAsync = promisify(exec);
const CWD = '/home/ubuntu/apps/agentic-os';

// POST /api/bots/auth — start device flow for a bot
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { appId } = body;
    if (!appId) return err('appId is required', 400);

    // Find the lark-cli profile for this app
    const { stdout: profileList } = await execAsync('lark-cli profile list', { cwd: CWD });
    const profiles = JSON.parse(profileList);
    const profile = Array.isArray(profiles)
      ? profiles.find((p: Record<string, string>) => p.appId === appId || p['app-id'] === appId)
      : null;

    if (!profile) return err('No lark-cli profile found for this app. Register the bot first.', 404);

    const profileName = profile.name || profile.profileName;

    // Switch to this profile
    await execAsync(`lark-cli profile use "${profileName}"`, { cwd: CWD });

    // Logout old user token first (so new auth replaces it)
    try {
      await execAsync('lark-cli auth logout --json', { cwd: CWD, timeout: 5000 });
    } catch { /* ignore if no user was logged in */ }

    // Start device flow with explicit scopes
    const { stdout } = await execAsync(
      'lark-cli auth login --no-wait --json --scope "calendar:calendar:read calendar:calendar.event:read calendar:calendar.event:create calendar:calendar.event:update calendar:calendar.event:delete contact:user.base:readonly contact:user:search im:message im:message:send_as_bot im:chat:read offline_access"',
      { cwd: CWD }
    );
    const authData = JSON.parse(stdout);

    if (!authData.verification_url) {
      return err('Failed to start device flow', 500);
    }

    log.info({ appId, profileName, verificationUrl: authData.verification_url }, 'Device flow started');

    return ok({
      deviceCode: authData.device_code,
      verificationUrl: authData.verification_url,
      profileName,
      expiresIn: authData.expires_in || 600,
    });
  } catch (e) {
    log.error({ err: e }, 'Failed to start auth');
    return err('Failed to start auth', 500);
  }
}

// GET /api/bots/auth?deviceCode=xxx&appId=xxx — try to complete device flow
export async function GET(request: Request) {
  const url = new URL(request.url);
  const deviceCode = url.searchParams.get('deviceCode');
  const appId = url.searchParams.get('appId');
  if (!deviceCode || !appId) return err('deviceCode and appId required', 400);

  try {
    // Find the profile for this app
    const { stdout: profileList } = await execAsync('lark-cli profile list', { cwd: CWD });
    const profiles = JSON.parse(profileList);
    const profile = Array.isArray(profiles)
      ? profiles.find((p: Record<string, string>) => p.appId === appId || p['app-id'] === appId)
      : null;

    if (!profile) return err('No profile found', 404);

    const profileName = profile.name || profile.profileName;
    await execAsync(`lark-cli profile use "${profileName}"`, { cwd: CWD });

    // Try to complete device flow
    let result: Record<string, unknown>;
    try {
      const { stdout } = await execAsync(
        `lark-cli auth login --device-code "${deviceCode}" --json`,
        { cwd: CWD, timeout: 30000 }
      );
      result = JSON.parse(stdout);
    } catch (e: unknown) {
      // Device code already consumed (auth completed) or expired
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('invalid') || errMsg.includes('authorization failed') || errMsg.includes('expired')) {
        // Check if user is actually logged in now
        try {
          const { stdout: statusOut } = await execAsync('lark-cli auth status --json', { cwd: CWD });
          const statusData = JSON.parse(statusOut);
          if (statusData.identities?.user?.status === 'ready') {
            // Auth already completed — treat as success
            result = { ok: true };
          } else if (errMsg.includes('expired')) {
            return ok({ status: 'expired', hint: 'Authorization expired' });
          } else {
            return ok({ status: 'pending', hint: 'Waiting for authorization' });
          }
        } catch {
          return ok({ status: 'pending', hint: 'Waiting for authorization' });
        }
      } else {
        log.error({ err: e }, 'Device code poll failed');
        return err('Auth check failed: ' + errMsg, 500);
      }
    }

    // Check if auth succeeded — verify we got the NEW user, not a cached old one
    if (result.ok || result.status === 'success' || result.user) {
      // Auth succeeded — get user info via lark-cli (this should be the NEW user)
      let userName = 'User';
      let userId = '';
      try {
        // First check who lark-cli thinks is logged in
        const { stdout: statusOut } = await execAsync(
          'lark-cli auth status --json',
          { cwd: CWD }
        );
        const statusData = JSON.parse(statusOut);
        userId = statusData.identities?.user?.openId || '';
        userName = statusData.identities?.user?.userName || 'User';
      } catch (e) {
        log.warn({ err: e }, 'Failed to get user info after auth');
      }

      // Get the actual token from lark-cli and store in DB
      try {
        const { stdout: tokenInfo } = await execAsync(
          'lark-cli auth token --as user --json',
          { cwd: CWD }
        );
        const tokenData = JSON.parse(tokenInfo);

        if (tokenData.access_token && tokenData.access_token !== 'lark-cli-managed') {
          const expiresAt = new Date(Date.now() + (tokenData.expires_in || 7200) * 1000);
          // Delete old tokens for this app first
          await query('DELETE FROM lark_user_tokens WHERE app_id = $1', [appId]);
          await query(
            `INSERT INTO lark_user_tokens (user_id, app_id, access_token, refresh_token, expires_at, scopes)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [userName, appId, tokenData.access_token, tokenData.refresh_token || null, expiresAt, '{calendar,contact,im}']
          );
          log.info({ appId, userName, userId }, 'Token stored in DB from lark-cli');
        } else {
          throw new Error('Token extraction returned marker or empty');
        }
      } catch (e) {
        log.warn({ err: e }, 'Failed to extract token from lark-cli, storing marker');
        // Fallback: store marker so tools know to use lark-cli
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        // Delete old markers
        await query('DELETE FROM lark_user_tokens WHERE app_id = $1 AND access_token = $2', [appId, 'lark-cli-managed']);
        await query(
          `INSERT INTO lark_user_tokens (user_id, app_id, access_token, refresh_token, expires_at, scopes)
           VALUES ($1, $2, 'lark-cli-managed', null, $3, $4)
           ON CONFLICT (user_id, app_id) DO UPDATE SET
             access_token = 'lark-cli-managed',
             expires_at = $3,
             updated_at = now()`,
          [userName, appId, expiresAt, '{calendar,contact,im}']
        );
      }

      log.info({ appId, userName, userId }, 'Auth completed');
      return ok({ status: 'success', userName, userId });
    }

    // Check for specific errors
    const errObj = result.error as Record<string, string> | undefined;
    if (errObj?.type === 'authorization_pending' || errObj?.message?.includes('pending')) {
      return ok({ status: 'pending', hint: 'Waiting for authorization' });
    }
    if (errObj?.type === 'expired_token' || errObj?.message?.includes('expired')) {
      return ok({ status: 'expired', hint: 'Authorization expired' });
    }

    // Not yet authorized
    return ok({
      status: 'pending',
      hint: errObj?.message || 'Waiting for authorization',
    });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    // lark-cli returns exit code when not yet authorized — check if it's a pending error
    if (errMsg.includes('pending') || errMsg.includes('authorization_pending')) {
      return ok({ status: 'pending', hint: 'Waiting for authorization' });
    }
    if (errMsg.includes('expired')) {
      return ok({ status: 'expired', hint: 'Authorization expired' });
    }
    log.error({ err: e }, 'Failed to check auth');
    return err('Failed to check auth: ' + errMsg, 500);
  }
}

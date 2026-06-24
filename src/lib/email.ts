/**
 * GOR-112: Resend email channel for proactive notifications.
 * Fallback when Lark is unavailable or for email-preferring users.
 */
import { Resend } from 'resend';
import { childLogger } from './logger';

const log = childLogger('email');

const resendApiKey = process.env.RESEND_API_KEY || '';
const FROM_EMAIL = process.env.EMAIL_FROM || 'noreply@agenticos.app';
const FROM_NAME = process.env.EMAIL_FROM_NAME || 'Agentic OS';

let resend: Resend | null = null;

function getResend(): Resend {
  if (!resend) {
    if (!resendApiKey) throw new Error('RESEND_API_KEY not configured');
    resend = new Resend(resendApiKey);
  }
  return resend;
}

export interface EmailOptions {
  to: string | string[];
  subject: string;
  html?: string;
  text?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}

/**
 * Send an email via Resend.
 */
export async function sendEmail(options: EmailOptions): Promise<{ id: string; success: boolean; error?: string }> {
  try {
    const client = getResend();
    const recipients = Array.isArray(options.to) ? options.to : [options.to];

    const result = await client.emails.send({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: recipients,
      subject: options.subject,
      html: options.html || options.text || '',
      text: options.text || '',
      reply_to: options.replyTo,
      tags: options.tags,
    } as Parameters<typeof client.emails.send>[0]);

    log.info({ id: result.data?.id, to: recipients, subject: options.subject }, 'Email sent');
    return { id: result.data?.id || '', success: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Unknown error';
    log.error({ error, to: options.to, subject: options.subject }, 'Email send failed');
    return { id: '', success: false, error };
  }
}

/**
 * Send a notification email with standard styling.
 */
export async function sendNotificationEmail(
  to: string,
  subject: string,
  body: string,
  options?: { priority?: 'high' | 'normal'; actionUrl?: string; actionLabel?: string }
): Promise<{ id: string; success: boolean; error?: string }> {
  const priorityHeader = options?.priority === 'high' ? '🔴 ' : '';
  const actionButton = options?.actionUrl
    ? `<a href="${options.actionUrl}" style="display:inline-block;padding:12px 24px;background:#4F46E5;color:white;text-decoration:none;border-radius:6px;font-weight:bold;margin-top:16px;">${options.actionLabel || 'View'}</a>`
    : '';

  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#1a1a2e;border-radius:12px;padding:24px;color:#e0e0e0;">
        <h2 style="color:#7C3AED;margin:0 0 16px;">🐾 ${FROM_NAME}</h2>
        <div style="line-height:1.6;white-space:pre-wrap;">${body}</div>
        ${actionButton}
        <hr style="border:none;border-top:1px solid #333;margin:24px 0;">
        <p style="color:#666;font-size:12px;">This is an automated notification from Agentic OS.</p>
      </div>
    </div>
  `;

  return sendEmail({
    to,
    subject: `${priorityHeader}${subject}`,
    html,
    tags: [{ name: 'type', value: 'notification' }],
  });
}

/**
 * Send a proactive briefing email.
 */
export async function sendBriefingEmail(
  to: string,
  userName: string,
  briefing: string
): Promise<{ id: string; success: boolean; error?: string }> {
  return sendNotificationEmail(
    to,
    `☀️ Good Morning, ${userName}!`,
    briefing,
    { actionUrl: process.env.APP_URL, actionLabel: 'Open Dashboard' }
  );
}

/**
 * Send an approval request email.
 */
export async function sendApprovalEmail(
  to: string,
  title: string,
  details: string,
  approveUrl: string,
  rejectUrl: string
): Promise<{ id: string; success: boolean; error?: string }> {
  const html = `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <div style="background:#1a1a2e;border-radius:12px;padding:24px;color:#e0e0e0;">
        <h2 style="color:#F59E0B;margin:0 0 16px;">⏳ Approval Required</h2>
        <h3 style="color:white;margin:0 0 12px;">${title}</h3>
        <div style="line-height:1.6;white-space:pre-wrap;">${details}</div>
        <div style="margin-top:24px;">
          <a href="${approveUrl}" style="display:inline-block;padding:12px 24px;background:#10B981;color:white;text-decoration:none;border-radius:6px;font-weight:bold;margin-right:8px;">✅ Approve</a>
          <a href="${rejectUrl}" style="display:inline-block;padding:12px 24px;background:#EF4444;color:white;text-decoration:none;border-radius:6px;font-weight:bold;">❌ Reject</a>
        </div>
        <hr style="border:none;border-top:1px solid #333;margin:24px 0;">
        <p style="color:#666;font-size:12px;">This is an approval request from Agentic OS.</p>
      </div>
    </div>
  `;

  return sendEmail({
    to,
    subject: `⏳ Approval Required: ${title}`,
    html,
    tags: [{ name: 'type', value: 'approval' }],
  });
}

/**
 * Check if email is configured.
 */
export function isEmailConfigured(): boolean {
  return !!resendApiKey;
}

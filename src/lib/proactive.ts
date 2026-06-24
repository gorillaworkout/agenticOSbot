/**
 * Proactive Engine — The brain that makes AgenticOS autonomous
 * Handles: cron scheduling, webhook events, context detection
 */

import { getOne, getMany, query } from '@/lib/db';
import { chatCompletion } from '@/lib/llm';
import { getToolDefinitions, executeTool } from '@/lib/tools';
import { sendLarkMessage } from '@/lib/lark';
import { childLogger } from '@/lib/logger';

const log = childLogger('proactive');

// === Rule Types ===

export interface ProactiveRule {
  id: string;
  user_id: string;
  name: string;
  type: 'cron' | 'webhook' | 'event';
  trigger_config: Record<string, unknown>;
  action_type: string;
  action_config: Record<string, unknown>;
  enabled: boolean;
}

// === Morning Briefing (GOR-94) ===

export async function runMorningBriefing(userId: string, appId: string, chatId: string): Promise<string> {
  log.info({ userId, appId, chatId }, 'Running morning briefing');

  const tools = await getToolDefinitions();
  const toolList = tools.map(t => `- ${t.function.name}: ${t.function.description}`).join('\n');

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);

  const systemPrompt = `You are Agentic OS generating a morning briefing. Be concise, use emojis, and organize clearly.

You have these tools:
${toolList}

Generate a morning briefing by calling these tools in order:
1. lark_calendar_events — get today's schedule (startTime: ${todayStart.toISOString()}, endTime: ${todayEnd.toISOString()})
2. lark_approval_list — check pending approvals
3. lark_task_list — check pending tasks

After getting all results, format as a morning briefing with sections:
📅 Today's Schedule
⏳ Pending Approvals  
✅ Pending Tasks
💡 Recommendations`;

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: 'Generate my morning briefing now. Call the tools and format the results.' },
  ];

  return await runToolLoop(messages, appId, chatId, 5);
}

// === Approval Auto-Handler (GOR-95) ===

export async function handleApprovalWebhook(userId: string, appId: string, chatId: string, approvalData: {
  instance_code: string;
  task_id?: string;
  approval_name?: string;
  applicant_name?: string;
  form_data?: unknown;
}): Promise<string> {
  log.info({ userId, instance_code: approvalData.instance_code }, 'Handling approval webhook');

  await query(
    `INSERT INTO approval_cache (user_id, instance_code, task_id, approval_name, applicant_name, form_data)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT DO NOTHING`,
    [userId, approvalData.instance_code, approvalData.task_id, approvalData.approval_name,
     approvalData.applicant_name, JSON.stringify(approvalData.form_data || {})]
  );

  const summary = await chatCompletion([
    { role: 'system', content: 'Summarize this approval request in 2-3 sentences. Be clear about what is requested and by whom.' },
    { role: 'user', content: `Approval: ${approvalData.approval_name || 'Unknown'}\nApplicant: ${approvalData.applicant_name || 'Unknown'}\nData: ${JSON.stringify(approvalData.form_data || {})}` },
  ]);

  const text = `🔔 **Approval Request**\n\n${summary.content}\n\n📋 ${approvalData.instance_code}\n👤 ${approvalData.applicant_name || 'Unknown'}`;

  await sendApprovalCard(appId, chatId, text, approvalData.instance_code, approvalData.task_id || '');
  return text;
}

async function sendApprovalCard(appId: string, chatId: string, text: string, instanceCode: string, taskId: string) {
  const card = {
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '🔔 New Approval' }, template: 'orange' },
    elements: [
      { tag: 'markdown', content: text },
      { tag: 'action', actions: [
        { tag: 'button', text: { tag: 'plain_text', content: '✅ Approve' }, type: 'primary', value: { action: 'approval_approve', instance_code: instanceCode, task_id: taskId } },
        { tag: 'button', text: { tag: 'plain_text', content: '❌ Reject' }, type: 'danger', value: { action: 'approval_reject', instance_code: instanceCode, task_id: taskId } },
      ] },
    ],
  };
  await sendLarkMessage(appId, '', chatId, 'interactive', JSON.stringify(card), 'chat_id');
}

// === Meeting Reminder (GOR-96) ===

export async function checkMeetingReminders(userId: string, appId: string, chatId: string): Promise<number> {
  const now = new Date();
  const in30min = new Date(now.getTime() + 30 * 60 * 1000);

  const result = await executeTool('lark_calendar_events', {
    startTime: now.toISOString(),
    endTime: in30min.toISOString(),
  }, { appId, chatId });

  if (!result.success || result.output.includes('No events')) return 0;

  const lines = result.output.split('\n').filter(l => l.trim());
  let reminded = 0;

  for (const line of lines) {
    // Match format: "1. Title - 21 Jun 2026, 16:00 WIB (event_id: xxx)"
    const eventMatch = line.match(/\d+\.\s+(.+?)\s+-\s+.*?(\d{2}:\d{2})\s+WIB/);
    if (!eventMatch) {
      // Fallback: try matching without time
      const simpleMatch = line.match(/\d+\.\s+(.+?)\s+-\s+/);
      if (!simpleMatch) continue;
      const title = simpleMatch[1].trim();
      const eventId = (line.match(/event_id:\s*(\S+)/)?.[1]) || title;

      const existing = await getOne<{ id: string }>(
        'SELECT id FROM calendar_reminders WHERE user_id = $1 AND event_id = $2 AND reminder_type = $3',
        [userId, eventId, '15min']
      );
      if (existing) continue;

      const text = `⏰ **Meeting in ~15 min!**\n\n📅 ${title}\n\n💡 Need prep? Just ask!`;
      await sendLarkMessage(appId, '', chatId, 'text', JSON.stringify({ text }), 'chat_id');
      await query('INSERT INTO calendar_reminders (user_id, event_id, reminder_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, eventId, '15min']);
      reminded++;
      continue;
    }

    const [, title, startTime] = eventMatch;
    const eventId = (line.match(/event_id:\s*(\S+)/)?.[1]) || title;

    const existing = await getOne<{ id: string }>(
      'SELECT id FROM calendar_reminders WHERE user_id = $1 AND event_id = $2 AND reminder_type = $3',
      [userId, eventId, '15min']
    );
    if (existing) continue;

    const text = `⏰ **Meeting in ~15 min!**\n\n📅 ${title}\n🕐 ${startTime}\n\n💡 Need prep? Just ask!`;
    await sendLarkMessage(appId, '', chatId, 'text', JSON.stringify({ text }), 'chat_id');
    await query('INSERT INTO calendar_reminders (user_id, event_id, reminder_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [userId, eventId, '15min']);
    reminded++;
  }

  return reminded;
}

// === Smart Context (GOR-97) ===

export async function detectSmartContext(message: string, appId: string, chatId: string): Promise<string | null> {
  // Detect Lark doc/wiki/sheet/base links
  const docLinkMatch = message.match(/(?:open\.larksuite\.com|larksuite\.com|g5uv1sd55bh\.sg\.larksuite\.com)\/(docx|wiki|sheets|base)(\/([a-zA-Z0-9_-]+))?/);
  if (docLinkMatch) {
    const type = docLinkMatch[1];
    // Try to extract token from URL path or query
    const pathMatch = message.match(/\/(docx|wiki|sheets|base)\/([a-zA-Z0-9_-]+)/);
    const token = pathMatch?.[2];
    if (token) {
      if (type === 'wiki') {
        const r = await executeTool('lark_wiki_get_node', { token }, { appId, chatId });
        if (r.success) return `📎 Wiki link detected:\n\n${r.output}`;
      } else if (type === 'sheets') {
        const r = await executeTool('lark_sheets_info', { spreadsheetToken: token }, { appId, chatId });
        if (r.success) return `📊 Spreadsheet detected:\n\n${r.output}`;
      } else if (type === 'base') {
        // Extract appToken from URL, try to list tables and read first one
        const appToken = token;
        const info = await executeTool('lark_bitable_tables', { appToken }, { appId, chatId });
        if (info.success) {
          return `📊 Base/Bitable detected: ${appToken}\n\n${info.output.slice(0, 3000)}${info.output.length > 3000 ? '\n[...truncated]' : ''}\n\n💡 Ask me things like "total amount paid" or "count rows" to analyze this data!`;
        }
        // Fallback: try common table ID patterns
        return `📊 Base/Bitable detected: ${appToken}\n\nI can see this is a Bitable but couldn't read the table list. Please tell me the table ID (e.g. "table1" or "tblXXX") and I'll read it!`;
      } else {
        const r = await executeTool('lark_docs_read', { documentId: token }, { appId, chatId });
        if (r.success) return `📄 Document detected:\n\n${r.output.slice(0, 2000)}${r.output.length > 2000 ? '\n[...truncated]' : ''}`;
      }
    }
  }

  // Detect "siapa [name]" patterns
  const whoMatch = message.match(/(?:siapa|who is|cari orang|find person)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
  if (whoMatch) {
    const r = await executeTool('lark_search_user', { query: whoMatch[1] }, { appId, chatId });
    if (r.success && !r.output.includes('No users')) return `👤 User search "${whoMatch[1]}":\n\n${r.output}`;
  }

  // Detect quick-task patterns: "todo: buy milk" / "ingatkan X"
  const todoMatch = message.match(/^(?:todo|task|ingatkan|remind me)[:\s]+(.+)/i);
  if (todoMatch) {
    const r = await executeTool('lark_task_create', { title: todoMatch[1] }, { appId, chatId });
    if (r.success) return `✅ Quick task created: ${todoMatch[1]}`;
  }

  // NLP-based reminder intent detection (GOR-122)
  const reminderIntent = detectReminderIntent(message);
  if (reminderIntent) {
    const title = reminderIntent.title || 'Reminder';
    const r = await executeTool('lark_task_create', { title, dueDate: reminderIntent.dueDate }, { appId, chatId });
    if (r.success) return `⏰ Reminder set: **${title}**${reminderIntent.dueDate ? ` (due: ${reminderIntent.dueDate})` : ''}`;
  }

  return null;
}

// === Tool Loop Helper ===

async function runToolLoop(messages: { role: 'system' | 'user' | 'assistant'; content: string }[], appId: string, chatId: string, maxRounds: number): Promise<string> {
  let finalResponse = '';

  for (let round = 0; round < maxRounds; round++) {
    const response = await chatCompletion(messages);
    const toolCalls = parseToolCalls(response.content);

    if (toolCalls.length === 0) { finalResponse = response.content; break; }

    const tc = toolCalls[0];
    const result = await executeTool(tc.name, tc.args, { appId, chatId });

    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: `[Tool: ${tc.name}]\n${result.output}\n\nContinue or give final answer.` });
  }

  if (!finalResponse) {
    const final = await chatCompletion([...messages, { role: 'user', content: 'Give the final answer now.' }]);
    finalResponse = final.content;
  }

  return finalResponse;
}

// === Daily Chat Summary (GOR-99) ===

export async function runDailyChatSummary(userId: string, appId: string, chatId: string): Promise<string> {
  log.info({ userId, appId, chatId }, 'Running daily chat summary');

  // Get today's messages from all conversations
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const messages = await getMany<{
    content: string;
    role: string;
    conversation_title: string;
    created_at: string;
  }>(
    `SELECT m.content, m.role, c.title as conversation_title, m.created_at
     FROM messages m
     JOIN conversations c ON m.conversation_id = c.id
     WHERE c.user_id = $1 AND m.created_at >= $2 AND m.role IN ('USER', 'ASSISTANT')
     ORDER BY m.created_at DESC
     LIMIT 100`,
    [userId, todayStart]
  );

  if (messages.length === 0) return 'No conversations today.';

  // Summarize with LLM
  const messageText = messages
    .reverse()
    .map(m => `[${m.role}] ${m.content.slice(0, 500)}`)
    .join('\n');

  const summary = await chatCompletion([
    { role: 'system', content: 'You are a daily chat summarizer. Create a concise summary of today\'s conversations. Group by topic, highlight key decisions, action items, and important information. Use emojis and be organized.' },
    { role: 'user', content: `Summarize today\'s conversations:\n\n${messageText}` },
  ]);

  const text = `📝 **Daily Chat Summary**\n\n${summary.content}`;
  await sendLarkMessage(appId, '', chatId, 'text', JSON.stringify({ text }), 'chat_id');
  return summary.content;
}

// === Deadline Tracker (GOR-100) ===

export async function runDeadlineTracker(userId: string, appId: string, chatId: string): Promise<string> {
  log.info({ userId, appId, chatId }, 'Running deadline tracker');

  // Check Lark tasks approaching deadline
  const taskResult = await executeTool('lark_task_list', { status: 'TODO' }, { appId, chatId });

  if (!taskResult.success || taskResult.output.includes('No tasks')) {
    return 'No pending tasks found.';
  }

  // Use LLM to analyze deadlines
  const analysis = await chatCompletion([
    { role: 'system', content: 'You are a deadline tracker. Analyze these tasks and identify:\n1. Tasks due TODAY (urgent)\n2. Tasks due TOMORROW (warning)\n3. Tasks due this week (info)\n4. Overdue tasks (critical)\n\nFormat with emojis: 🔴 overdue, 🟠 today, 🟡 tomorrow, 🟢 this week. Be concise.' },
    { role: 'user', content: `Analyze these tasks for deadlines:\n\n${taskResult.output}` },
  ]);

  if (analysis.content.includes('No urgent') || analysis.content.includes('no tasks')) {
    return 'All tasks on track.';
  }

  const text = `📅 **Deadline Tracker**\n\n${analysis.content}`;
  await sendLarkMessage(appId, '', chatId, 'text', JSON.stringify({ text }), 'chat_id');
  return analysis.content;
}

// === Contextual Search (GOR-101) ===

export async function detectContextualSearch(message: string, appId: string, chatId: string): Promise<string | null> {
  // Detect questions that might benefit from knowledge base search
  const questionPatterns = [
    /(?:apa itu|what is|what are|jelaskan|explain|bagaimana|how|kenapa|why|siapa|who)\s+(.+)/i,
    /(?:cari|search|find|lookup)\s+(?:info|informasi|data|document|dokumen)\s+(?:tentang|about|on|for)?\s*(.+)/i,
    /(?:tolong|help|bisa can)\s+(.+\?)/i,
  ];

  for (const pattern of questionPatterns) {
    const match = message.match(pattern);
    if (match) {
      const query = match[1].trim();
      if (query.length < 3) continue;

      // Search knowledge base first
      const kbResult = await executeTool('kb_search', { query }, { appId, chatId });
      if (kbResult.success && !kbResult.output.includes('No knowledge base entries found')) {
        // Use LLM to format a natural response from KB data
        try {
          const formatted = await chatCompletion([
            { role: 'system', content: 'You are a helpful assistant. Given knowledge base search results, provide a natural, conversational answer to the user\'s question. Do NOT show raw data — synthesize it into a clear response. If the data doesn\'t fully answer the question, say what you know and note any gaps. Respond in the same language as the user.' },
            { role: 'user', content: `User asked: "${message}"\n\nKnowledge base results:\n${kbResult.output}\n\nProvide a natural response based on this data.` }
          ], { temperature: 0.3, maxTokens: 500 });
          return formatted.content;
        } catch {
          // Fallback to raw output if LLM fails
          return `🔍 **Knowledge Base**\n\n${kbResult.output}`;
        }
      }

      // Search web if no KB results
      const webResult = await executeTool('web_search', { query }, { appId, chatId });
      if (webResult.success && !webResult.output.includes('No results')) {
        return `🌐 **Web Search**\n\n${webResult.output.slice(0, 1500)}${webResult.output.length > 1500 ? '\n[...truncated]' : ''}`;
      }
    }
  }

  return null;
}

// === Proactive Rule Executor ===

export async function executeProactiveRule(rule: ProactiveRule): Promise<void> {
  const larkConfig = await getOne<{ app_id: string; chat_id: string }>(
    'SELECT app_id, chat_id FROM lark_user_config WHERE user_id = $1 AND enabled = true LIMIT 1',
    [rule.user_id]
  );
  if (!larkConfig) return;

  const { app_id: appId, chat_id: chatId } = larkConfig;
  const run = await getOne<{ id: string }>(
    'INSERT INTO proactive_runs (rule_id, user_id, status) VALUES ($1, $2, $3) RETURNING id',
    [rule.id, rule.user_id, 'running']
  );

  try {
    let output = '';
    switch (rule.action_type) {
      case 'morning_briefing':
        output = await runMorningBriefing(rule.user_id, appId, chatId);
        if (output) await sendLarkMessage(appId, '', chatId, 'text', JSON.stringify({ text: `☀️ **Good Morning!**\n\n${output}` }), 'chat_id');
        break;
      case 'meeting_reminder':
        const count = await checkMeetingReminders(rule.user_id, appId, chatId);
        output = `${count} reminder(s) sent.`;
        break;
      case 'daily_summary':
        output = await runDailyChatSummary(rule.user_id, appId, chatId);
        break;
      case 'deadline_tracker':
        output = await runDeadlineTracker(rule.user_id, appId, chatId);
        break;
      case 'memory_digest':
        output = await runDailyMemoryDigest(rule.user_id, appId, chatId);
        break;
    }

    if (run) await query('UPDATE proactive_runs SET status=$1, output=$2, completed_at=now() WHERE id=$3', ['completed', output, run.id]);
    await query('UPDATE proactive_rules SET last_run_at=now(), run_count=run_count+1, next_run_at=$1 WHERE id=$2', [calculateNextRun(rule.trigger_config), rule.id]);
  } catch (e) {
    const error = e instanceof Error ? e.message : 'unknown';
    if (run) await query('UPDATE proactive_runs SET status=$1, error=$2, completed_at=now() WHERE id=$3', ['failed', error, run.id]);
  }
}

// === Scheduler ===

export async function runProactiveScheduler(): Promise<void> {
  const dueRules = await getMany<ProactiveRule>(
    `SELECT * FROM proactive_rules WHERE enabled = true AND type = 'cron' AND (next_run_at IS NULL OR next_run_at <= now()) ORDER BY next_run_at ASC LIMIT 10`
  );
  for (const rule of dueRules) {
    try { await executeProactiveRule(rule); } catch (e) { log.error({ ruleId: rule.id, err: e }, 'Rule failed'); }
  }
}

// === Default Rules ===

export async function setupDefaultProactiveRules(userId: string): Promise<void> {
  await query(
    `INSERT INTO proactive_rules (user_id, name, type, trigger_config, action_type, action_config, next_run_at)
     VALUES ($1, 'Morning Briefing', 'cron', '{"cron": "0 1 * * *"}', 'morning_briefing', '{}', $2)`,
    [userId, calculateNextRun({ cron: '0 1 * * *' })]
  );
  await query(
    `INSERT INTO proactive_rules (user_id, name, type, trigger_config, action_type, action_config, next_run_at)
     VALUES ($1, 'Meeting Reminder', 'cron', '{"cron": "*/10 * * * *"}', 'meeting_reminder', '{}', $2)`,
    [userId, calculateNextRun({ cron: '*/10 * * * *' })]
  );
  // GOR-131: Daily memory digest at 9pm WIB (14:00 UTC)
  await query(
    `INSERT INTO proactive_rules (user_id, name, type, trigger_config, action_type, action_config, next_run_at)
     VALUES ($1, 'Daily Memory Digest', 'cron', '{"cron": "0 14 * * *"}', 'memory_digest', '{}', $2)
     ON CONFLICT DO NOTHING`,
    [userId, calculateNextRun({ cron: '0 14 * * *' })]
  );
  log.info({ userId }, 'Default proactive rules created');
}

// === Helpers ===

function calculateNextRun(config: Record<string, unknown>): Date {
  const cron = String(config.cron || '0 1 * * *');
  const now = new Date();

  if (cron.startsWith('*/')) {
    const m = parseInt(cron.match(/^\*\/(\d+)/)?.[1] || '10');
    return new Date(now.getTime() + m * 60_000);
  }

  // Daily at specific hour
  const hourMatch = cron.match(/^(\d+)\s+(\d+)/);
  if (hourMatch) {
    const next = new Date(now);
    next.setUTCHours(parseInt(hourMatch[2]), 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }

  return new Date(now.getTime() + 60 * 60_000); // default 1 hour
}

function parseToolCalls(content: string): { name: string; args: Record<string, unknown> }[] {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const regex = /\{"tool_call":\s*\{"name":\s*"([^"]+)",\s*"args":\s*(\{.*?\})\}\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try { calls.push({ name: match[1], args: JSON.parse(match[2]) }); } catch { /* skip */ }
  }
  return calls;
}

// === NLP Reminder Intent Detection (GOR-122) ===
interface ReminderIntent {
  title: string;
  dueDate?: string;
  originalText: string;
}

function detectReminderIntent(text: string): ReminderIntent | null {
  const lower = text.toLowerCase();

  // Match reminder patterns: "ingatkan saya ...", "remind me ...", "jangan lupa ...", "nanti jam ..."
  const patterns = [
    /(?:ingatkan\s+(?:saya|aku)|remind\s+me|jangan\s+lupa|tolong\s+ingat)[:\s]+(.+)/i,
    /(?:reminder|ingat)[:\s]+(.+)/i,
    /(?:set\s+(?:a\s+)?reminder\s+(?:for|to|that))[:\s]+(.+)/i,
  ];

  let title = '';
  for (const p of patterns) {
    const m = text.match(p);
    if (m) { title = m[1].trim(); break; }
  }
  if (!title) return null;

  const now = new Date();
  let dueDate: string | undefined;

  // "in X hours/minutes/days"
  const relMatch = title.match(/(?:in|dalam)\s+(\d+)\s+(?:jam|hour|hr|menit|minute|min|hari|day)/i);
  if (relMatch) {
    const num = parseInt(relMatch[1]);
    const unit = /(jam|hour|hr)/i.test(title) ? 'hours' : /(menit|minute|min)/i.test(title) ? 'minutes' : 'days';
    const d = new Date(now);
    if (unit === 'hours') d.setHours(d.getHours() + num);
    else if (unit === 'minutes') d.setMinutes(d.getMinutes() + num);
    else d.setDate(d.getDate() + num);
    dueDate = d.toISOString();
  }

  // "besok jam HH:MM" / "tomorrow at HH:MM"
  const tomorrowMatch = title.match(/(?:besok|tomorrow)\s+(?:jam|at|pukul)?\s*(\d{1,2})(?::(\d{2}))?/i);
  if (tomorrowMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(parseInt(tomorrowMatch[1]), parseInt(tomorrowMatch[2] || '0'), 0, 0);
    dueDate = d.toISOString();
  }

  // "lusa jam HH:MM"
  const lusaMatch = title.match(/(?:lusa)\s+(?:jam|at|pukul)?\s*(\d{1,2})(?::(\d{2}))?/i);
  if (lusaMatch) {
    const d = new Date(now);
    d.setDate(d.getDate() + 2);
    d.setHours(parseInt(lusaMatch[1]), parseInt(lusaMatch[2] || '0'), 0, 0);
    dueDate = d.toISOString();
  }

  // "jam HH:MM" (today, future check)
  const todayTimeMatch = title.match(/(?:jam|at|pukul)\s*(\d{1,2})(?::(\d{2}))?/i);
  if (todayTimeMatch && !tomorrowMatch && !lusaMatch) {
    const d = new Date(now);
    d.setHours(parseInt(todayTimeMatch[1]), parseInt(todayTimeMatch[2] || '0'), 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    dueDate = d.toISOString();
  }

  // "nanti sore/siang/pagi/malam"
  const nantiMatch = title.match(/(?:nanti)\s+(sore|siang|pagi|malam)/i);
  if (nantiMatch && !todayTimeMatch) {
    const d = new Date(now);
    const timeMap: Record<string, number> = { pagi: 9, siang: 13, sore: 17, malam: 21 };
    const hour = timeMap[nantiMatch[1].toLowerCase()] || 17;
    d.setHours(hour, 0, 0, 0);
    if (d <= now) d.setDate(d.getDate() + 1);
    dueDate = d.toISOString();
  }

  return { title, dueDate, originalText: text };
}

// === Daily Memory Digest (GOR-131) ===

export async function runDailyMemoryDigest(userId: string, appId: string, chatId: string): Promise<string> {
  log.info({ userId }, 'Running daily memory digest');

  const stats = await getOne<{
    total_notes: number;
    notes_today: number;
    total_entities: number;
    total_links: number;
  }>(
    `SELECT
      (SELECT count(*) FROM knowledge_notes WHERE user_id = $1) as total_notes,
      (SELECT count(*) FROM knowledge_notes WHERE user_id = $1 AND created_at >= now() - interval '1 day') as notes_today,
      (SELECT count(*) FROM knowledge_entities WHERE user_id = $1) as total_entities,
      (SELECT count(*) FROM knowledge_links) as total_links`,
    [userId]
  );

  const recentNotes = await getMany<{ title: string; tags: string[]; created_at: string }>(
    'SELECT title, tags, created_at FROM knowledge_notes WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5',
    [userId]
  );

  const recentEntities = await getMany<{ name: string; entity_type: string }>(
    'SELECT name, entity_type FROM knowledge_entities WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 5',
    [userId]
  );

  const parts: string[] = [];
  parts.push('🧠 **Daily Memory Digest**\n');
  parts.push(`📝 Notes: ${stats?.total_notes || 0} total, ${stats?.notes_today || 0} today`);
  parts.push(`🏷️ Entities: ${stats?.total_entities || 0}`);
  parts.push(`🔗 Links: ${stats?.total_links || 0}\n`);

  if (recentNotes.length > 0) {
    parts.push('📋 **Recent Memories:**');
    for (const n of recentNotes) {
      const tags = Array.isArray(n.tags) ? n.tags.join(', ') : '';
      parts.push(`• ${n.title} [${tags}]`);
    }
  }

  if (recentEntities.length > 0) {
    parts.push('\n🏷️ **Known Entities:**');
    for (const e of recentEntities) parts.push(`• ${e.name} (${e.entity_type})`);
  }

  const digest = parts.join('\n');

  await sendLarkMessage(appId, '', chatId, 'interactive', JSON.stringify({
    config: { wide_screen_mode: true },
    header: { title: { tag: 'plain_text', content: '🧠 Daily Memory Digest' }, template: 'turquoise' },
    elements: [{ tag: 'markdown', content: digest }],
  }), 'chat_id');

  return digest;
}

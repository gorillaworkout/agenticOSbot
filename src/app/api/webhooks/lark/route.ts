import { getOne, getMany, query } from '@/lib/db';
import { ok, err, parseBody } from '@/lib/api';
import { parseLarkEvent, sendLarkMessage, updateLarkMessage, downloadLarkFile } from '@/lib/lark';
import { defaultCard, errorCard, successCard, infoCard, loadingCard, actionValue, button, md, divider, buildCard, header, actionBlock, note, calendarCard, taskListCard, searchResultCard, confirmationCard, type LarkCard } from '@/lib/lark-cards';
import { detectSmartContext, detectContextualSearch, handleApprovalWebhook } from '@/lib/proactive';
import { childLogger } from '@/lib/logger';
import { chatCompletion } from '@/lib/llm';
import { getToolDefinitions, executeTool } from '@/lib/tools';
import { autoLearn, getUserPersona } from '@/lib/learning';
import { withLLMRetry, withToolRetry } from '@/lib/resilient';

const log = childLogger('webhook:lark');

// HITL: Destructive tools that require user confirmation before execution
const DESTRUCTIVE_TOOLS = new Set([
  'lark_calendar_delete', 'lark_calendar_update',
  'lark_task_complete',
  'lark_approval_approve', 'lark_approval_reject',
  'lark_docs_update', 'lark_docs_create',
  'lark_sheets_write',
  'ms365_email_send',
  'workflow_delete',
  'note_create', 'note_update',
  'memory_set',
]);

function isDestructive(toolName: string): boolean {
  return DESTRUCTIVE_TOOLS.has(toolName);
}

// Deduplication: Lark sometimes delivers the same event multiple times
// Use TTL cache to track recently processed message_ids
const processedMessages = new Map<string, number>();
const DEDUP_TTL_MS = 60_000; // 1 minute
setInterval(() => {
  const now = Date.now();
  for (const [id, ts] of processedMessages) {
    if (now - ts > DEDUP_TTL_MS) processedMessages.delete(id);
  }
}, 30_000).unref();

function isDuplicate(messageId: string): boolean {
  if (!messageId) return false;
  if (processedMessages.has(messageId)) return true;
  processedMessages.set(messageId, Date.now());
  return false;
}

export async function POST(request: Request) {
  try {
    const body = await parseBody<unknown>(request);
    const event = parseLarkEvent(body);

    // Handle URL verification challenge
    if (event.challenge) {
      return Response.json({ challenge: event.challenge });
    }

    if (!event.header || !event.event) {
      return err('Invalid event payload', 400);
    }

    const { event_type, app_id } = event.header;

    // Find lark config for this app
    const config = await getOne<{ id: string; user_id: string; app_secret: string; bot_open_id: string }>(
      'SELECT id, user_id, app_secret, bot_open_id FROM lark_config WHERE app_id = $1 AND enabled = true',
      [app_id]
    );
    if (!config) {
      log.warn({ app_id }, 'No lark config found');
      return ok({ received: true });
    }

    // Debug: log all event types to see what's coming in
    log.info({ event_type, app_id, has_event: !!event.event }, 'Lark webhook event received');

    // Handle calendar events (auto-detect meetings the bot is invited to)
    if (event_type === 'calendar.calendar.event.changed_v4' || event_type === 'calendar.calendar.event.created_v4' || event_type === 'calendar.calendar.acl.created_v4') {
      try {
        await handleCalendarEvent(event.event as Record<string, unknown>);
      } catch (calErr) {
        log.error({ err: calErr }, 'Calendar event handler failed');
      }
      return ok({ received: true });
    }

    // Handle card action events (approval buttons, etc)
    if (event_type === 'card.action.trigger' || event_type === 'application.bot.card_action_trigger') {
      try {
        await handleCardAction(event.event as Record<string, unknown>, app_id, config);
      } catch (cardErr) {
        log.error({ err: cardErr }, 'Card action handler failed');
      }
      return ok({ received: true });
    }

    // Handle message events
    if (event_type === 'im.message.receive_v1') {
      const msg = event.event as Record<string, unknown>;
      const message = msg.message as Record<string, unknown> | undefined;
      if (!message) return ok({ received: true });

      const content = typeof message.content === 'string' ? JSON.parse(message.content) : message.content;
      const chatId = message.chat_id as string;
      const messageType = message.message_type as string;
      const messageId = message.message_id as string;
      const chatType = message.chat_type as string; // 'p2p' or 'group'
      const rootId = message.root_id as string || ''; // GOR-124: thread root
      const parentId = message.parent_id as string || ''; // GOR-124: thread parent
      const senderId = ((msg.sender as Record<string, unknown>)?.sender_id as Record<string, unknown>)?.open_id as string;

      if (!chatId) return ok({ received: true });

      // GOR-119: Group chat — only respond when bot is mentioned
      const mentions = message.mentions as Array<{ key: string; id: { open_id: string; union_id: string }; name: string }> | undefined;
      const botMentioned = mentions?.some(m => m.id?.open_id === config.bot_open_id);
      if (chatType === 'group' && !botMentioned) {
        log.debug({ chatId, messageId }, 'Group message without mention, ignoring');
        return ok({ received: true, skipped: 'no_mention' });
      }

      // Deduplicate: skip if this message was already processed recently
      if (isDuplicate(messageId)) {
        log.info({ messageId, chatId }, 'Duplicate Lark message, skipping');
        return ok({ received: true, duplicate: true });
      }

      try {

      let textContent = '';
      let fileContext = '';

      if (messageType === 'text') {
        let rawText = (content as Record<string, unknown>)?.text as string || '';
        // Strip @mention tags (Lark sends @_user_N placeholders)
        rawText = rawText.replace(/@_user_\d+/g, '').trim();
        textContent = rawText;
      } else if (messageType === 'file' || messageType === 'image') {
        // Extract file_key from content
        const fileKey = (content as Record<string, unknown>)?.file_key as string
          || (content as Record<string, unknown>)?.image_key as string;
        const fileName = (content as Record<string, unknown>)?.file_name as string || 'uploaded file';

        if (fileKey) {
          log.info({ fileKey, messageType, fileName, messageId }, 'Downloading Lark file');
          const dl = await downloadLarkFile(app_id, config.app_secret, messageId, fileKey, messageType as 'file' | 'image');

          if (dl.ok && dl.buffer) {
            // For PDFs, extract text
            if (fileName?.endsWith('.pdf') || dl.contentType === 'application/pdf') {
              try {
                // Import from lib/pdf-parse.js directly to avoid the debug code in index.js
                // (which tries to read a test file and crashes in bundled environments)
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const pdfParse: (buf: Buffer) => Promise<{ text: string; numpages: number }> = require('pdf-parse/lib/pdf-parse.js');
                const parsed = await pdfParse(dl.buffer);
                fileContext = `[User uploaded PDF: "${fileName}" — ${parsed.numpages} pages]\n\n${parsed.text.slice(0, 15000)}`;
                if (parsed.text.length > 15000) fileContext += '\n\n[...truncated at 15000 chars]';
                textContent = `Please analyze this uploaded document.`;
                log.info({ fileName, pages: parsed.numpages, textLen: parsed.text.length }, 'PDF parsed');
              } catch (pdfErr) {
                log.error({ err: pdfErr }, 'PDF parse failed');
                textContent = `[User uploaded a PDF file "${fileName}" but I could not parse it. Please ask them to describe the content.]`;
              }
            } else if (messageType === 'image') {
              // GOR-123: Vision — send image as multimodal content to LLM
              const mime = dl.contentType || 'image/png';
              const b64 = dl.buffer.toString('base64');
              const dataUrl = `data:${mime};base64,${b64}`;
              log.info({ contentType: mime, sizeKB: Math.round(dl.buffer.length / 1024) }, 'Image downloaded for vision analysis');
              // Store as structured multimodal content for chat messages
              fileContext = JSON.stringify({ type: 'image_url', image_url: { url: dataUrl, detail: 'high' } });
              textContent = 'Please analyze this uploaded image.';
              // Mark as vision message so chatMessages uses multimodal format
              (msg as Record<string, unknown>)._isVisionImage = true;
            } else if (fileName?.endsWith('.docx') || dl.contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
              // For DOCX files, extract text with mammoth
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const mammoth = require('mammoth') as { extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string; messages: unknown[] }> };
                const result = await mammoth.extractRawText({ buffer: dl.buffer });
                const text = result.value.slice(0, 15000).replace(/\x00/g, '');
                fileContext = `[User uploaded DOCX: "${fileName}"]\n\n${text}`;
                if (result.value.length > 15000) fileContext += '\n\n[...truncated at 15000 chars]';
                textContent = `Please analyze this uploaded document.`;
                log.info({ fileName, textLen: result.value.length }, 'DOCX parsed');
              } catch (docxErr) {
                log.error({ err: docxErr }, 'DOCX parse failed');
                textContent = `[User uploaded a DOCX file "${fileName}" but I could not parse it. Please ask them to describe the content.]`;
              }
            } else if (fileName?.endsWith('.xlsx') || fileName?.endsWith('.xls') || dl.contentType?.includes('spreadsheet') || dl.contentType?.includes('excel')) {
              // For Excel files, parse with xlsx
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const XLSX = require('xlsx') as { read: (data: Buffer, opts: Record<string, unknown>) => { SheetNames: string[]; Sheets: Record<string, unknown> }; utils: { sheet_to_csv: (sheet: unknown) => string } };
                const workbook = XLSX.read(dl.buffer, { type: 'buffer' });
                const allSheets: string[] = [];
                for (const sheetName of workbook.SheetNames) {
                  const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
                  allSheets.push(`=== Sheet: ${sheetName} ===\n${csv}`);
                }
                const fullText = allSheets.join('\n\n').replace(/\x00/g, '');
                const maxLen = 50000;
                fileContext = `[User uploaded Excel: "${fileName}" — ${workbook.SheetNames.length} sheet(s)]\n\n${fullText.slice(0, maxLen)}`;
                if (fullText.length > maxLen) fileContext += `\n\n[...truncated at ${maxLen} chars]`;
                textContent = `Analyze this Excel file. Show key stats, totals, and summary.`;
                log.info({ fileName, sheets: workbook.SheetNames.length, textLen: fullText.length }, 'Excel parsed');
              } catch (xlsErr) {
                log.error({ err: xlsErr }, 'Excel parse failed');
                textContent = `[User uploaded Excel "${fileName}" but parsing failed. Ask them to describe the content or upload as CSV.]`;
              }
            } else if (fileName?.endsWith('.csv') || dl.contentType?.includes('csv') || dl.contentType?.includes('text/csv')) {
              // For CSV files, parse with csv-parse and format as table
              try {
                // eslint-disable-next-line @typescript-eslint/no-require-imports
                const { parse: csvParse } = require('csv-parse/sync') as { parse: (input: string, opts: Record<string, unknown>) => string[][] };
                const csvText = dl.buffer.toString('utf-8').replace(/\x00/g, '');
                const records: string[][] = csvParse(csvText, { skip_empty_lines: true, bom: true });
                const headers = records[0] || [];
                const rows = records.slice(1);
                // Format as readable text table
                let formatted = `Headers: ${headers.join(' | ')}\n`;
                formatted += `Total rows: ${rows.length}\n\n`;
                // Include all rows up to limit
                const maxRows = 1000;
                for (let i = 0; i < Math.min(rows.length, maxRows); i++) {
                  formatted += headers.map((h, j) => `${h}: ${rows[i]?.[j] || ''}`).join(' | ') + '\n';
                }
                if (rows.length > maxRows) formatted += `\n[...and ${rows.length - maxRows} more rows]\n`;
                fileContext = `[User uploaded CSV: "${fileName}" — ${rows.length} data rows, ${headers.length} columns]\n\n${formatted}`;
                textContent = `Analyze this CSV data. Show key stats, totals, and summary.`;
                log.info({ fileName, rows: rows.length, cols: headers.length }, 'CSV parsed');
              } catch (csvErr) {
                log.error({ err: csvErr }, 'CSV parse failed');
                // Fallback: read as raw text with higher limit
                const rawText = dl.buffer.toString('utf-8').slice(0, 50000).replace(/\x00/g, '');
                fileContext = `[User uploaded CSV: "${fileName}"]\n\n${rawText}`;
                textContent = `Analyze this CSV data.`;
                log.info({ fileName, size: dl.buffer.length }, 'CSV read as raw text fallback');
              }
            } else {
              // For other files, try to read as text (sanitized)
              const rawText = dl.buffer.toString('utf-8').slice(0, 50000);
              // Remove null bytes and other problematic chars for PostgreSQL
              const text = rawText.replace(/\x00/g, '');
              fileContext = `[User uploaded file: "${fileName}"]\n\n${text}`;
              textContent = `Please analyze this uploaded file.`;
              log.info({ fileName, size: dl.buffer.length }, 'File downloaded as text');
            }
          } else {
            log.error({ error: dl.error }, 'Failed to download Lark file');
            textContent = `[User tried to upload a file but download failed]`;
          }
        }
      } else {
        // Unsupported message type — skip
        return ok({ received: true });
      }

      if (!textContent && !fileContext) return ok({ received: true });

      log.info({ chatId, senderId, text: textContent.slice(0, 100) }, 'Lark message received');

      // GOR-120: Slash commands — intercept before LLM for fast execution
      const slashResult = await handleSlashCommand(textContent, app_id, config, chatId, senderId, rootId || parentId);
      if (slashResult) {
        await sendLarkMessage(app_id, config.app_secret, chatId, 'interactive', JSON.stringify(slashResult), 'chat_id', rootId || parentId || undefined);
        return ok({ received: true, slashCommand: true });
      }

      // GOR-119: Group chats — per-user conversation context
      // For groups, use senderId as conversation key so each user has own context
      // For p2p, use chatId as before
      const convKey = chatType === 'group' ? senderId : chatId;
      let conv = await getOne<{ id: string }>(
        "SELECT id FROM conversations WHERE user_id = $1 AND metadata->>'lark_chat_id' = $2",
        [config.user_id, convKey]
      );
      if (!conv) {
        conv = await getOne<{ id: string }>(
          `INSERT INTO conversations (user_id, title, metadata) VALUES ($1, $2, $3) RETURNING id`,
          [config.user_id, chatType === 'group' ? `Lark Group: ${senderId}` : `Lark: ${chatId}`, JSON.stringify({ lark_chat_id: convKey, lark_sender_id: senderId, chat_type: chatType })]
        );
      }
      if (!conv) return ok({ received: true });

      // === SMART CONTEXT (GOR-97): Auto-detect links, names, quick-tasks ===
      if (!fileContext) {
        try {
          const smartResult = await detectSmartContext(textContent, app_id, chatId);
          if (smartResult) {
            await sendLarkMessage(app_id, config.app_secret, chatId, 'interactive', JSON.stringify(defaultCard(smartResult)), 'chat_id', rootId || parentId || undefined);
            await query(
              "INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'ASSISTANT', $2, $3)",
              [conv.id, smartResult, JSON.stringify({ source: 'lark', smartContext: true })]
            );
            // Auto-learn from smart context exchange (fire-and-forget)
            autoLearn(config.user_id, conv.id, textContent, smartResult).catch(e => log.error({ err: e }, 'autoLearn failed'));
            return ok({ received: true, smartContext: true });
          }

          // Contextual search fallback — search KB/web for questions
          const contextResult = await detectContextualSearch(textContent, app_id, chatId);
          if (contextResult) {
            await sendLarkMessage(app_id, config.app_secret, chatId, 'interactive', JSON.stringify(defaultCard(contextResult)), 'chat_id', rootId || parentId || undefined);
            await query(
              "INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'ASSISTANT', $2, $3)",
              [conv.id, contextResult, JSON.stringify({ source: 'lark', contextualSearch: true })]
            );
            // Auto-learn from contextual search exchange (fire-and-forget)
            autoLearn(config.user_id, conv.id, textContent, contextResult).catch(e => log.error({ err: e }, 'autoLearn failed'));
            return ok({ received: true, contextualSearch: true });
          }
        } catch (scErr) {
          log.error({ err: scErr }, 'Smart context detection failed, continuing with normal flow');
        }
      }

      // If file was uploaded, prepend file context to the user message
      const userMessage = (fileContext
        ? `${fileContext}\n\nUser message: ${textContent}`
        : textContent
      ).replace(/\x00/g, ''); // sanitize null bytes for PostgreSQL

      // Store incoming message (enriched with file content if applicable)
      await query(
        "INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'USER', $2, $3)",
        [conv.id, userMessage, JSON.stringify({ source: 'lark', senderId, fileUploaded: !!fileContext })]
      );

      // Build chat context and get LLM response with tool-calling
      const history = await getMany<{ role: string; content: string }>(
        "SELECT role, content FROM messages WHERE conversation_id = $1 AND content != '' ORDER BY created_at DESC LIMIT 10",
        [conv.id]
      );
      history.reverse();

      const tools = await getToolDefinitions();
      const toolList = tools.map(t => `- ${t.function.name}(${Object.keys(t.function.parameters.properties || {}).join(', ')}): ${t.function.description}`).join('\n');

      // GOR-130: Inject user persona from learned memory
      const userPersona = await getUserPersona(config.user_id);

      const systemPrompt = `You are Agentic OS, responding to messages from Lark. Be concise and helpful.${userPersona ? `

USER CONTEXT (use this to personalize your responses):
${userPersona}` : ''}

You have access to the following tools:
${toolList}

Tool call format:
{"tool_call": {"name": "tool_name", "args": {"arg1": "value1"}}}

EXAMPLES:
- "buat meeting jam 2" → lark_calendar_create(summary, startTime, endTime)
- "invite Gusti" → lark_search_user("Gusti") → lark_calendar_update(eventId, addAttendees=open_id)
- "update meeting jadi jam 3" → lark_calendar_events → lark_calendar_update(eventId, startTime=new_time)
- "jadwal hari ini" → lark_calendar_events(calendarId, startTime, endTime)

CRITICAL RULES:
- ALWAYS use tools when the user asks to DO something. You MUST call tools — never refuse, never suggest manual action.
- When a task needs multiple tools, call them ONE BY ONE. The system will feed results back to you.
- For calendar creation with invitees: search users first with lark_search_user, then create event with attendeeIds.
- For UPDATING meetings (add attendees, change time, change title): use lark_calendar_update with eventId. You MUST know the eventId first — get it from lark_calendar_events.
- For DELETING meetings: use lark_calendar_delete with eventId.
- For "today" calendar queries, use startTime/endTime as ISO 8601 with +07:00 timezone.
- Timezone for Indonesia: Asia/Jakarta (+07:00 WIB).
- When user says "buat meeting", "buatkan jadwal", "create event" — you MUST call lark_calendar_create immediately.
- NEVER say "I cannot" or "I'm unable" or "do it yourself". You have the tools. USE THEM.
- For reading Lark docs: use lark_docs_read with document_id (from URL after /docx/).
- For creating docs: use lark_docs_create with title.
- For browsing wiki: use lark_wiki_list_spaces → lark_wiki_list_nodes → lark_wiki_get_node → lark_docs_read.
- For Lark tasks: use lark_task_create, lark_task_list, lark_task_complete, lark_task_search.
- For approvals: use lark_approval_list to see pending, lark_approval_approve/lark_approval_reject to process.
- For spreadsheets: use lark_sheets_info to list sheets, lark_sheets_read to read, lark_sheets_write to write, lark_sheets_create to create.
- For Drive: use lark_drive_search to find files, lark_drive_upload/download, lark_drive_create_folder.
- For Video Conferences: use lark_vc_search to find meetings, lark_vc_notes for meeting notes.
- For Group Management: use lark_group_list, lark_group_create, lark_group_members.
- For Lark Base (Bitable): use lark_bitable_tables to list tables, lark_bitable_list to read records. When sharing a Base link, auto-discover tables and offer to read data. When user asks about data ("total amount paid", "count rows", etc.), use lark_bitable_list to fetch records then calculate.
- For Learning: use learn_create to save notes, learn_search to find info, learn_list to browse. When user says "ingat ini", "catat", "remember", "save this" — ALWAYS create a note. Auto-learn important facts from conversations.
- NEVER say "create it manually" or "do it yourself". USE YOUR TOOLS.
- For proactive: morning briefing runs automatically at 8am WIB. Meeting reminders push 15min before. Smart context auto-detects doc links, person searches, and quick tasks.
- For IMAGE analysis: When user sends an image, you can SEE it (multimodal). Describe and analyze the image content directly. No special tool needed.`;

      const chatMessages: { role: 'system' | 'user' | 'assistant'; content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> }[] = [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({ role: m.role.toLowerCase() as 'user' | 'assistant' | 'system', content: m.content.slice(0, 4000) })),
      ];

      // GOR-123: Add current message with vision support
      const userMsgContent: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }> = (fileContext && fileContext.startsWith('{"type":"image_url"') && (msg as Record<string, unknown>)._isVisionImage)
        ? [{ type: 'text', text: textContent || 'Please analyze this image.' }, JSON.parse(fileContext)]
        : userMessage;
      chatMessages.push({ role: 'user', content: userMsgContent });

      // Tool-calling loop (up to 10 rounds for multi-step tasks)
      const MAX_TOOL_ROUNDS = 10;
      let finalResponse = '';
      const toolsUsed: string[] = [];

      for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const toolDefs = await getToolDefinitions();
        const nativeTools = toolDefs.map(t => ({ type: 'function', function: { name: t.function.name, description: t.function.description, parameters: t.function.parameters } }));
        const response = await withLLMRetry(() => chatCompletion(chatMessages, { tools: nativeTools }));
        log.info({ round, responseLen: response.content.length, preview: response.content.slice(0, 300) }, 'LLM response for tool parsing');

        // Check native tool_calls from API first (OpenAI format)
        let toolCalls: { name: string; args: Record<string, unknown> }[] = [];
        if (response.toolCalls && response.toolCalls.length > 0) {
          toolCalls = response.toolCalls.map(tc => ({
            name: tc.function.name,
            args: (() => { try { return JSON.parse(tc.function.arguments || '{}'); } catch { return {}; } })()
          }));
        } else {
          toolCalls = parseToolCallsFromResponse(response.content);
        }

        if (toolCalls.length === 0) {
          finalResponse = response.content;
          break;
        }

        const toolCall = toolCalls[0];
        toolsUsed.push(toolCall.name);
        log.info({ tool: toolCall.name, args: toolCall.args, round }, 'Lark tool call');

        // HITL: Intercept destructive tools — send confirmation card first
        if (isDestructive(toolCall.name)) {
          const pendingId = await createPendingAction(chatId, app_id, senderId, toolCall.name, toolCall.args);
          const argsPreview = JSON.stringify(toolCall.args, null, 2).slice(0, 500);
          const confirmCard = confirmationCard(
            `⚠️ Confirm: **${toolCall.name}**\n\n\`\`\`\n${argsPreview}\n\`\`\``,
            { confirmLabel: '✅ Execute', cancelLabel: '❌ Cancel', destructive: true, pendingId, chatId }
          );
          await sendLarkMessage(app_id, config.app_secret, chatId, 'interactive', JSON.stringify(confirmCard), 'chat_id', rootId || parentId || undefined);
          finalResponse = `⏳ Waiting for confirmation of \`${toolCall.name}\`. The action will execute once you approve.`;
          break;
        }

        const result = await withToolRetry(() => executeTool(toolCall.name, toolCall.args, { appId: app_id, chatId: chatId }), toolCall.name);
        log.info({ tool: toolCall.name, success: result.success, output: result.output.slice(0, 200) }, 'Lark tool result');

        // If calendar tool returned no events, append OAuth link for user authorization
        let toolOutput = result.output;
        if (toolCall.name === 'lark_calendar_events' && (result.output.includes('No events found') || result.output.startsWith('Error'))) {
          const oauthUrl = `https://agentic.gorillaworkout.id/api/lark/oauth/callback?action=authorize&userId=${encodeURIComponent(senderId)}&appId=${encodeURIComponent(app_id)}`;
          toolOutput += `\n\n[If the user's calendar events are not showing, they may need to authorize the bot. Send this OAuth URL to the user: ${oauthUrl}]`;
        }

        chatMessages.push({ role: 'assistant', content: response.content });
        chatMessages.push({ role: 'user', content: `[Tool Result: ${toolCall.name}]\n${toolOutput}\n\nIf the user's request is fully complete, give a final answer in the user's language. If more tools are needed, call them now.` });
      }

      // If loop ended without a final response, force one more LLM call to summarize
      if (!finalResponse) {
        log.info({ toolsUsed }, 'Max tool rounds reached, forcing final answer');
        chatMessages.push({ role: 'user', content: `Based on the tool results above, give a clear final answer to the user now.` });
        try {
          const finalAnswer = await withLLMRetry(() => chatCompletion(chatMessages));
          finalResponse = finalAnswer.content;
        } catch (e) {
          log.error({ err: e }, 'Final answer LLM call failed');
          finalResponse = `Saya menemukan informasi berikut:\n\n${toolsUsed.length > 0 ? 'Tools used: ' + toolsUsed.join(', ') : ''}`;
        }
      }

      // Fallback if LLM returns empty content
      const replyText = finalResponse?.trim() || 'Maaf, saya tidak bisa menghasilkan respons saat ini. Coba lagi sebentar ya 🙏';

      log.info({ chatId, toolsUsed, replyLen: replyText.length }, 'Lark reply generated');

      // Store assistant response
      await query(
        "INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'ASSISTANT', $2, $3)",
        [conv.id, replyText, JSON.stringify({ source: 'lark', toolsUsed })]
      );

      // Auto-learn from conversation (fire-and-forget)
      autoLearn(config.user_id, conv.id, textContent, replyText).catch(e => log.error({ err: e }, 'autoLearn failed'));

      // Send reply via Lark (auto-detect card type based on tools used)
      const sendCard = autoDetectCard(replyText, toolsUsed);
      // GOR-124: Reply in-thread if message is part of a thread
      const replyTo = rootId || parentId || undefined;
      const sendResult = await sendLarkMessage(app_id, config.app_secret, chatId, 'interactive', JSON.stringify(sendCard), 'chat_id', replyTo);
      } catch (msgErr) {
        log.error({ err: msgErr, chatId, senderId }, 'Lark message processing failed');
        // Try to send error message back to user so they know something went wrong
        try {
          await sendLarkMessage(app_id, config.app_secret, chatId, 'interactive', JSON.stringify(errorCard('Processing failed', 'Sorry, I encountered an error. Please try again.')), 'chat_id', rootId || parentId || undefined);
        } catch (sendErr) {
          log.error({ err: sendErr }, 'Failed to send error message back to Lark');
        }
      }
    }

    return ok({ received: true });
  } catch (e) {
    log.error({ err: e }, 'Lark webhook error');
    return err('Webhook processing failed', 500);
  }
}

/**
 * GOR-120: Slash commands — fast-path handlers that bypass LLM.
 * Returns LarkCard if command matched, null otherwise.
 */
async function handleSlashCommand(
  text: string,
  appId: string,
  config: { user_id: string; app_secret: string },
  chatId: string,
  senderId: string,
  replyTo?: string
): Promise<LarkCard | null> {
  const cmd = text.trim().toLowerCase();

  if (cmd === '/help') {
    return {
      config: { enable_forward: true },
      header: { title: { tag: 'plain_text', content: '📚 Commands' }, template: 'indigo' },
      elements: [{
        tag: 'markdown',
        content: [
          '**Slash Commands:**',
          '• `/help` — Show this help',
          '• `/jadwal` — Today\'s schedule',
          '• `/task` — Your pending tasks',
          '• `/approval` — Pending approvals',
          '• `/memory` — Memory stats',
          '• `/digest` — Run memory digest',
          '',
          '**Natural Language:**',
          'Just type normally! Examples:',
          '• "Buat meeting jam 2"',
          '• "Cari Gusti"',
          '• "Apa jadwalku besok?"',
          '• "Ingat: rumah di Jl. Merdeka"',
        ].join('\n'),
      }],
    };
  }

  if (cmd === '/jadwal') {
    try {
      const result = await executeTool('lark_calendar_events', {}, { appId, chatId });
      const events = parseCalendarEvents(result.output);
      if (events.length > 0) return calendarCard(events);
      return infoCard('📅 Today\'s Schedule', 'No events found for today.');
    } catch {
      return errorCard('Schedule Error', 'Could not fetch calendar.');
    }
  }

  if (cmd === '/task') {
    try {
      const result = await executeTool('lark_task_list', {}, { appId, chatId });
      const tasks = parseTasks(result.output);
      if (tasks.length > 0) return taskListCard(tasks, { title: 'Your Tasks' });
      return infoCard('✅ Tasks', 'No pending tasks. Nice!');
    } catch {
      return errorCard('Task Error', 'Could not fetch tasks.');
    }
  }

  if (cmd === '/approval') {
    try {
      const result = await executeTool('lark_approval_list', {}, { appId, chatId });
      if (result.output.includes('No pending')) return infoCard('⏳ Approvals', 'No pending approvals.');
      return defaultCard(result.output);
    } catch {
      return errorCard('Approval Error', 'Could not fetch approvals.');
    }
  }

  if (cmd === '/memory') {
    try {
      const { getGraphStats } = await import('@/lib/learning');
      const stats = await getGraphStats(config.user_id);
      const notes = (stats as Record<string, unknown>).totalNotes || 0;
      const entities = (stats as Record<string, unknown>).totalEntities || 0;
      const links = (stats as Record<string, unknown>).totalLinks || 0;
      return infoCard('🧠 Memory', `📝 Notes: ${notes}\n🏷️ Entities: ${entities}\n🔗 Links: ${links}`);
    } catch {
      return errorCard('Memory Error', 'Could not fetch memory stats.');
    }
  }

  if (cmd === '/digest') {
    try {
      const { runDailyMemoryDigest } = await import('@/lib/proactive');
      await runDailyMemoryDigest(config.user_id, appId, chatId);
      return infoCard('🧠 Digest Sent', 'Check the digest card above.');
    } catch {
      return errorCard('Digest Error', 'Could not run memory digest.');
    }
  }

  return null; // not a slash command
}

function parseToolCallsFromResponse(content: string): { name: string; args: Record<string, unknown> }[] {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  let match;

  // Format 1: {"tool_call": {"name": "...", "args": {...}}}
  const regex1 = /\{"tool_call":\s*\{"name":\s*"([^"]+)",\s*"args":\s*(\{.*?\})\}\}/g;
  while ((match = regex1.exec(content)) !== null) {
    try { toolCalls.push({ name: match[1], args: JSON.parse(match[2]) }); } catch { /* skip */ }
  }

  // Format 2: ```json {"tool_call": {...}} ```
  const regex2 = /```json\s*\n?([\s\S]*?)\n?\s*```/g;
  while ((match = regex2.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool_call?.name) toolCalls.push({ name: parsed.tool_call.name, args: parsed.tool_call.args || {} });
    } catch { /* skip */ }
  }

  // Format 3: {"tool_call": {"name": "...", "args": {...}}} (with nested args)
  if (toolCalls.length === 0) {
    const regex3 = /\{"tool_call":\s*\{"name":\s*"([^"]+)"/g;
    while ((match = regex3.exec(content)) !== null) {
      const name = match[1];
      // Try to extract args from the remaining content after this match
      const argsStart = content.indexOf('"args":', match.index);
      if (argsStart > 0) {
        const argsStr = content.slice(argsStart + 6);
        try {
          // Find balanced braces
          let depth = 0;
          let end = 0;
          for (let i = 0; i < argsStr.length; i++) {
            if (argsStr[i] === '{') depth++;
            if (argsStr[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
          }
          if (end > 0) toolCalls.push({ name, args: JSON.parse(argsStr.slice(0, end)) });
          else toolCalls.push({ name, args: {} });
        } catch { toolCalls.push({ name, args: {} }); }
      }
    }
  }

  // Format 4: lark_calendar_create("summary", "startTime", "endTime") or similar function call syntax
  if (toolCalls.length === 0) {
    const funcRegex = /(lark_\w+|ms365_\w+|kb_\w+|web_search|generate_pdf|google_drive_read|note_\w+|task_\w+|workflow_\w+|report_\w+|analytics_query|calculator|current_time|error_logs_search|plugin_\w+|memory_\w+|metrics_query|session_\w+)\s*\(([^)]*)\)/g;
    while ((match = funcRegex.exec(content)) !== null) {
      const name = match[1];
      const rawArgs = match[2].trim();
      const args: Record<string, unknown> = {};
      if (rawArgs) {
        // Parse "key=value" or positional args
        const parts = rawArgs.split(/,\s*/);
        for (const part of parts) {
          const kv = part.match(/"?([a-zA-Z_]+)"?\s*=\s*"?([^"]*)"?/);
          if (kv) args[kv[1]] = kv[2];
        }
      }
      toolCalls.push({ name, args });
    }
  }

  return toolCalls;
}

// Handle calendar event changes — cache events the bot is invited to
// Handle card action events (approval approve/reject buttons)
async function handleCardAction(event: Record<string, unknown>, appId: string, config: { id: string; user_id: string; app_secret: string }) {
  const action = event as Record<string, unknown>;
  const actionValue = action.action as Record<string, unknown> | undefined;
  const value = actionValue?.value as Record<string, unknown> | undefined;
  if (!value) return;

  const actionType = value.action as string;
  const instanceCode = value.instance_code as string;
  const taskId = value.task_id as string;
  const pendingId = value.pending_id as string;
  const chatId = value.chat_id as string || (action.open_chat_id as string) || '';
  const operatorId = (action.operator_id as string) || ((action.operator as Record<string, unknown>)?.open_id as string) || '';

  log.info({ actionType, instanceCode, taskId, pendingId, operatorId }, 'Card action received');

  // HITL: Confirm destructive action
  if (actionType === 'hitl_confirm' && pendingId) {
    const pending = await getOne<{ id: string; chat_id: string; app_id: string; tool_name: string; tool_args: Record<string, unknown> }>(
      "SELECT * FROM hitl_pending_actions WHERE id = $1 AND status = 'pending' AND expires_at > now()",
      [pendingId]
    );
    if (!pending) {
      if (chatId) await sendLarkMessage(appId, config.app_secret, chatId, 'interactive', JSON.stringify(errorCard('Action expired', 'This confirmation has expired. Please try again.')), 'chat_id');
      return;
    }
    await query("UPDATE hitl_pending_actions SET status = 'approved' WHERE id = $1", [pendingId]);
    const result = await executeTool(pending.tool_name, pending.tool_args, { appId: pending.app_id, chatId: pending.chat_id });
    const resultCard = result.success
      ? successCard('✅ Action Executed', `${pending.tool_name}\n\n${result.output.slice(0, 500)}`)
      : errorCard('❌ Action Failed', result.output.slice(0, 500));
    if (chatId) await sendLarkMessage(appId, config.app_secret, chatId, 'interactive', JSON.stringify(resultCard), 'chat_id');
    return;
  }

  // HITL: Reject destructive action
  if (actionType === 'hitl_reject' && pendingId) {
    await query("UPDATE hitl_pending_actions SET status = 'rejected' WHERE id = $1", [pendingId]);
    if (chatId) await sendLarkMessage(appId, config.app_secret, chatId, 'interactive', JSON.stringify(infoCard('❌ Cancelled', 'Action was cancelled.')), 'chat_id');
    return;
  }

  // Approval actions (legacy)
  if (actionType === 'approval_approve' && instanceCode && taskId) {
    const result = await executeTool('lark_approval_approve', { instanceId: instanceCode, taskId }, { appId });
    log.info({ result: result.output }, 'Approval approved via card action');
  } else if (actionType === 'approval_reject' && instanceCode && taskId) {
    const result = await executeTool('lark_approval_reject', { instanceId: instanceCode, taskId }, { appId });
    log.info({ result: result.output }, 'Approval rejected via card action');
  }
}

async function createPendingAction(chatId: string, appId: string, userId: string, toolName: string, toolArgs: Record<string, unknown>): Promise<string> {
  const row = await getOne<{ id: string }>(
    "INSERT INTO hitl_pending_actions (chat_id, app_id, user_id, tool_name, tool_args) VALUES ($1, $2, $3, $4, $5) RETURNING id",
    [chatId, appId, userId, toolName, JSON.stringify(toolArgs)]
  );
  return row?.id || '';
}

async function handleCalendarEvent(event: Record<string, unknown>) {
  const calendarId = event.calendar_id as string;
  const eventId = event.event_id as string;
  if (!calendarId || !eventId) return;

  // Only store events from calendars the bot has access to
  // (bot's own calendar "AgenticOS" + any shared calendars)
  const summary = (event.summary as string) || '';
  const description = (event.description as string) || '';
  const startTime = event.start_time as Record<string, unknown> | undefined;
  const endTime = event.end_time as Record<string, unknown> | undefined;
  const start = startTime?.timestamp ? new Date(Number(startTime.timestamp) * 1000) : null;
  const end = endTime?.timestamp ? new Date(Number(endTime.timestamp) * 1000) : null;
  const organizer = (event.organizer as Record<string, unknown>)?.user_id as string || '';
  const attendees = (event.attendees as unknown[]) || [];
  const location = (event.location as Record<string, unknown>)?.name as string || '';
  const status = (event.status as string) || 'confirmed';

  await query(
    `INSERT INTO calendar_events_cache
      (id, calendar_id, event_id, summary, description, start_time, end_time, organizer, attendees, location, status, raw_data, updated_at)
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     ON CONFLICT (calendar_id, event_id) DO UPDATE SET
      summary = EXCLUDED.summary,
      description = EXCLUDED.description,
      start_time = EXCLUDED.start_time,
      end_time = EXCLUDED.end_time,
      organizer = EXCLUDED.organizer,
      attendees = EXCLUDED.attendees,
      location = EXCLUDED.location,
      status = EXCLUDED.status,
      raw_data = EXCLUDED.raw_data,
      updated_at = now()`,
    [calendarId, eventId, summary, description, start, end, organizer, JSON.stringify(attendees), location, status, JSON.stringify(event)]
  );

  log.info({ calendarId, eventId, summary, start }, 'Calendar event cached');
}

/**
 * Auto-detect which card type to use based on the tools that were called.
 * Returns the appropriate card for the reply.
 */
function autoDetectCard(text: string, toolsUsed: string[]): LarkCard {
  const lastTool = toolsUsed[toolsUsed.length - 1];
  const footer = toolsUsed.length > 0 ? `Tools: ${toolsUsed.join(' → ')}` : undefined;

  // Calendar events → calendar card
  if (lastTool === 'lark_calendar_events' || lastTool === 'lark_calendar_list') {
    const events = parseCalendarEvents(text);
    if (events.length > 0) return calendarCard(events, { dateRange: 'Upcoming' });
  }

  // Task list → task card
  if (lastTool === 'lark_task_list' || lastTool === 'lark_task_search') {
    const tasks = parseTasks(text);
    if (tasks.length > 0) return taskListCard(tasks);
  }

  // Approval list → approval card
  if (lastTool === 'lark_approval_list') {
    // Use default card since approvals need interactive buttons (complex)
    return defaultCard(text, { footer });
  }

  // Calendar create/update/delete → success card
  if (lastTool === 'lark_calendar_create') return successCard('Event Created', text);
  if (lastTool === 'lark_calendar_update') return successCard('Event Updated', text);
  if (lastTool === 'lark_calendar_delete') return successCard('Event Deleted', text);
  if (lastTool === 'lark_task_create') return successCard('Task Created', text);
  if (lastTool === 'lark_task_complete') return successCard('Task Completed', text);

  // Default → standard card
  return defaultCard(text, { footer });
}

/** Parse calendar event text output into structured data */
function parseCalendarEvents(text: string): Array<{ summary: string; startTime: string; eventId?: string }> {
  const events: Array<{ summary: string; startTime: string; eventId?: string }> = [];
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    // Match: "1. Summary - Date Time WIB (event_id: xxx)"
    const match = line.match(/\d+\.\s*(.+?)\s*-\s*(.+?)\s*(?:WIB|\()(?:event_id:\s*(\S+))?/);
    if (match) {
      events.push({ summary: match[1].trim(), startTime: match[2].trim(), eventId: match[3] });
    }
  }
  return events;
}

/** Parse task text output into structured data */
function parseTasks(text: string): Array<{ title: string; done?: boolean; taskId?: string }> {
  const tasks: Array<{ title: string; done?: boolean; taskId?: string }> = [];
  const lines = text.split('\n').filter(l => l.trim());
  for (const line of lines) {
    // Match: "1. ✅ Title (id: xxx)" or "1. ⬜ Title (id: xxx)"
    const match = line.match(/\d+\.\s*(✅|⬜)\s*(.+?)\s*(?:\(id:\s*(\S+)\))?/);
    if (match) {
      tasks.push({ title: match[2].trim(), done: match[1] === '✅', taskId: match[3] });
    }
  }
  return tasks;
}

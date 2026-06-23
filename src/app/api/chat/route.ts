import { chatCompletion, chatCompletionStream } from '@/lib/llm';
import { authenticateRequest, requireAuth } from '@/lib/auth';
import { getOne, getMany, query } from '@/lib/db';
import { err, parseBody } from '@/lib/api';
import { getToolDefinitions, executeTool } from '@/lib/tools';
import { checkScheduledTasks } from '@/lib/scheduler';
import { z } from 'zod';

const ChatSchema = z.object({
  conversationId: z.string(),
  message: z.string().min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  stream: z.boolean().optional(),
});

const MAX_TOOL_ROUNDS = 5;

export async function POST(request: Request) {
  const user = await authenticateRequest(request);
  try { requireAuth(user); } catch (e) { return e as Response; }

  // Fire-and-forget scheduler check (non-blocking)
  checkScheduledTasks().catch(() => {});

  try {
    const body = await parseBody<z.infer<typeof ChatSchema>>(request);
    const parsed = ChatSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.issues[0].message, 400);

    const { conversationId, message, model, temperature, stream } = parsed.data;

    const conv = await getOne(
      'SELECT id FROM conversations WHERE id = $1 AND user_id = $2',
      [conversationId, user!.id]
    );
    if (!conv) return err('Conversation not found', 404);

    await query(
      "INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'USER', $2)",
      [conversationId, message]
    );

    const history = await getMany<{ role: string; content: string }>(
      "SELECT role, content FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 50",
      [conversationId]
    );

    const tools = await getToolDefinitions();

    // Build tool list for the system prompt so the model can't hallucinate names
    const toolList = tools.map(t => `- ${t.function.name}(${Object.keys(t.function.parameters.properties || {}).join(', ')}): ${t.function.description}`).join('\n');

    // Check current authorized user
    let authUserInfo = 'No Lark user authorized.';
    try {
      const { exec: execSync } = await import('child_process');
      const { promisify } = await import('util');
      const execAsyncLocal = promisify(execSync);
      const { stdout: authStatus } = await execAsyncLocal(
        'lark-cli auth status --json',
        { cwd: '/home/ubuntu/apps/agentic-os', timeout: 5000 }
      );
      const authData = JSON.parse(authStatus);
      if (authData.identities?.user?.status === 'ready') {
        authUserInfo = `Authorized Lark user: ${authData.identities.user.userName} (open_id: ${authData.identities.user.openId}). Scopes: ${authData.identities.user.scope}`;
      }
    } catch {}

    const systemPrompt = `You are Agentic OS, an AI agent assistant. You are helpful, concise, and capable.
You MUST use tools to perform actions. NEVER tell the user to do something manually when you have a tool for it.

Current Lark authorization status:
${authUserInfo}

When the user asks who is authorized, tell them the name and open_id from the info above.

Available tools:
${toolList}

TOOL CALL FORMAT — you MUST use this exact JSON format:
{"tool_call": {"name": "tool_name", "args": {"arg1": "value1"}}}

EXAMPLES (follow these patterns exactly):

User: "buatkan meeting jam 11:30 IT bersama Gusti"
You: First call current_time to get today's date, then call lark_calendar_create.
{"tool_call": {"name": "current_time", "args": {"timezone": "Asia/Jakarta"}}}
[after getting result, e.g. Thursday, June 18, 2026]
{"tool_call": {"name": "lark_calendar_create", "args": {"summary": "IT bersama Gusti", "startTime": "2026-06-18T11:30:00+07:00", "endTime": "2026-06-18T12:30:00+07:00"}}}

User: "buatkan meeting jam 2 siang meeting design review, invite Budi dan Ani"
You: Step 1 - get current time
{"tool_call": {"name": "current_time", "args": {"timezone": "Asia/Jakarta"}}}
Step 2 - search for "Budi" to get open_id
{"tool_call": {"name": "lark_search_user", "args": {"query": "Budi"}}}
Step 3 - search for "Ani" to get open_id
{"tool_call": {"name": "lark_search_user", "args": {"query": "Ani"}}}
Step 4 - create event with attendeeIds
{"tool_call": {"name": "lark_calendar_create", "args": {"summary": "Design Review", "startTime": "2026-06-18T14:00:00+07:00", "endTime": "2026-06-18T15:00:00+07:00", "attendeeIds": "ou_xxx,ou_yyy"}}}

User: "jadwal meeting hari ini"
You: {"tool_call": {"name": "lark_calendar_events", "args": {"calendarId": "primary", "startTime": "2026-06-18T00:00:00+07:00", "endTime": "2026-06-18T23:59:59+07:00"}}}

CRITICAL RULES:
- Use ONLY the exact tool names listed above.
- You can make MULTIPLE tool calls in sequence. The system will execute them one by one and feed results back to you.
- When a task requires multiple steps (e.g. search user → create event), do ALL steps in one conversation turn.
- If you don't need a tool, just respond normally with text.
- NEVER tell the user to "create it manually" or "do it yourself". You have the tools — USE THEM.
- For calendar creation: attendeeIds is OPTIONAL. Create the event even without attendee IDs.
- When user mentions invitees by name: use lark_search_user FIRST to get their open_id, then use those IDs as attendeeIds.
- Always use current_time first if you need today's date.
- Timezone for Indonesia: Asia/Jakarta (+07:00 WIB).
- If user tries to cancel/delete an event that's already cancelled, just tell them it's already cancelled — don't show an error.
- Calendar events list already filters cancelled events. If an event doesn't appear, it may already be cancelled.`;


    const chatMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...history.map(m => ({
        role: m.role.toLowerCase() as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ];

    // Track agent run
    const agentRun = await getOne<{ id: string }>(
      `INSERT INTO agent_runs (user_id, conversation_id, status, input)
       VALUES ($1, $2, 'EXECUTING', $3) RETURNING id`,
      [user!.id, conversationId, message]
    );
    const runId = agentRun?.id;

    const toolsUsed: string[] = [];
    let totalTokens = 0;
    let round = 0;

    // Non-streaming: tool-calling loop
    if (!stream) {
      while (round < MAX_TOOL_ROUNDS) {
        round++;
        const response = await chatCompletion(
          chatMessages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
          { model, temperature }
        );
        totalTokens += response.usage.total;

        const toolCalls = parseToolCallsFromResponse(response.content);
        if (toolCalls.length === 0) {
          await query(
            "INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'ASSISTANT', $2, $3)",
            [conversationId, response.content, JSON.stringify({ model: response.model, usage: response.usage, round })]
          );
          if (runId) {
            await query(
              `UPDATE agent_runs SET status='COMPLETED', output=$1, tools_used=$2, tokens_used=$3, completed_at=now() WHERE id=$4`,
              [response.content, toolsUsed, totalTokens, runId]
            );
          }
          await query('UPDATE conversations SET updated_at=now() WHERE id=$1', [conversationId]);
          return Response.json({ ok: true, data: { message: response.content, model: response.model, usage: response.usage, toolsUsed, rounds: round } });
        }

        const toolCall = toolCalls[0];
        toolsUsed.push(toolCall.name);
        await query("INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'TOOL', $2, $3)",
          [conversationId, JSON.stringify(toolCall), JSON.stringify({ type: 'tool_call', round })]);
        const result = await executeTool(toolCall.name, toolCall.args);
        await query("INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'TOOL', $2, $3)",
          [conversationId, result.output, JSON.stringify({ type: 'tool_result', tool: toolCall.name, success: result.success, executionTimeMs: result.executionTimeMs, round })]);

        chatMessages.push({ role: 'assistant', content: response.content });
        chatMessages.push({ role: 'user', content: `[Tool Result: ${toolCall.name}]\n${result.output}\n\nBased on this tool result, provide a helpful response to the user.` });
      }

      const finalMsg = 'I reached the maximum number of tool operations.';
      await query("INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'ASSISTANT', $2, $3)",
        [conversationId, finalMsg, JSON.stringify({ maxRounds: true, toolsUsed })]);
      if (runId) await query(`UPDATE agent_runs SET status='COMPLETED', output=$1, tools_used=$2, tokens_used=$3, completed_at=now() WHERE id=$4`,
        [finalMsg, toolsUsed, totalTokens, runId]);
      return Response.json({ ok: true, data: { message: finalMsg, toolsUsed, rounds: MAX_TOOL_ROUNDS, maxRoundsReached: true } });
    }

    // Streaming mode: tool-calling loop with SSE
    const encoder = new TextEncoder();
    const sse = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        };

        try {
          while (round < MAX_TOOL_ROUNDS) {
            round++;

            // Stream LLM response
            let fullContent = '';
            for await (const chunk of chatCompletionStream(
              chatMessages.map(m => ({ role: m.role as 'system' | 'user' | 'assistant', content: m.content })),
              { model, temperature }
            )) {
              fullContent += chunk;
              send('chunk', { content: chunk });
            }

            // Check for tool calls
            const toolCalls = parseToolCallsFromResponse(fullContent);
            if (toolCalls.length === 0) {
              // Final response — save
              await query(
                "INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'ASSISTANT', $2, $3)",
                [conversationId, fullContent, JSON.stringify({ model, round })]
              );
              if (runId) {
                await query(
                  `UPDATE agent_runs SET status='COMPLETED', output=$1, tools_used=$2, tokens_used=$3, completed_at=now() WHERE id=$4`,
                  [fullContent, toolsUsed, totalTokens, runId]
                );
              }
              await query('UPDATE conversations SET updated_at=now() WHERE id=$1', [conversationId]);
              send('done', { toolsUsed, rounds: round });
              controller.close();
              return;
            }

            // Execute tool
            const toolCall = toolCalls[0];
            toolsUsed.push(toolCall.name);
            send('tool_call', { name: toolCall.name, args: toolCall.args, round });

            await query("INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'TOOL', $2, $3)",
              [conversationId, JSON.stringify(toolCall), JSON.stringify({ type: 'tool_call', round })]);

            const result = await executeTool(toolCall.name, toolCall.args);

            await query("INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'TOOL', $2, $3)",
              [conversationId, result.output, JSON.stringify({ type: 'tool_result', tool: toolCall.name, success: result.success, executionTimeMs: result.executionTimeMs, round })]);

            send('tool_result', { name: toolCall.name, output: result.output, success: result.success, executionTimeMs: result.executionTimeMs, round });

            chatMessages.push({ role: 'assistant', content: fullContent });
            chatMessages.push({ role: 'user', content: `[Tool Result: ${toolCall.name}]\n${result.output}\n\nBased on this tool result, provide a helpful response to the user.` });
          }

          // Max rounds reached
          const finalMsg = 'I reached the maximum number of tool operations.';
          await query("INSERT INTO messages (conversation_id, role, content, metadata) VALUES ($1, 'ASSISTANT', $2, $3)",
            [conversationId, finalMsg, JSON.stringify({ maxRounds: true, toolsUsed })]);
          if (runId) await query(`UPDATE agent_runs SET status='COMPLETED', output=$1, tools_used=$2, tokens_used=$3, completed_at=now() WHERE id=$4`,
            [finalMsg, toolsUsed, totalTokens, runId]);
          send('done', { toolsUsed, rounds: round, maxRoundsReached: true });
          controller.close();
        } catch (e) {
          send('error', { message: String(e) });
          if (runId) await query(`UPDATE agent_runs SET status='FAILED', error=$1, completed_at=now() WHERE id=$2`, [String(e), runId]);
          controller.close();
        }
      }
    });

    return new Response(sse, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    console.error('Chat error:', e);
    return err('Chat failed: ' + String(e), 500);
  }
}

function parseToolCallsFromResponse(content: string): { name: string; args: Record<string, unknown> }[] {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const regex = /\{"tool_call":\s*\{"name":\s*"([^"]+)",\s*"args":\s*(\{.*?\})\}\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try { toolCalls.push({ name: match[1], args: JSON.parse(match[2]) }); } catch { /* skip */ }
  }
  const codeBlockRegex = /```json\s*\n?([\s\S]*?)\n?\s*```/g;
  while ((match = codeBlockRegex.exec(content)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed.tool_call?.name) toolCalls.push({ name: parsed.tool_call.name, args: parsed.tool_call.args || {} });
    } catch { /* skip */ }
  }
  return toolCalls;
}

import { childLogger } from './logger';

const log = childLogger('llm');

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string; detail?: string } }>;
}

interface LLMOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: Record<string, unknown>[];
}

interface LLMResponse {
  content: string;
  model: string;
  usage: { prompt: number; completion: number; total: number };
  finishReason: string;
  toolCalls?: { id?: string; type?: string; function: { name: string; arguments: string } }[];
}

const LLM_API_URL = process.env.LLM_API_URL || 'https://llm.fahmi.me';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

export async function chatCompletion(
  messages: ChatMessage[],
  options: LLMOptions = {}
): Promise<LLMResponse> {
  const { model = 'gemini-pro-agent', temperature = 0.7, maxTokens = 4096, tools } = options;

  log.debug({ model, msgCount: messages.length }, 'LLM request');

  const body: Record<string, unknown> = { model, messages, temperature, max_tokens: maxTokens };
  if (tools && tools.length > 0) body.tools = tools;

  const response = await fetch(`${LLM_API_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(LLM_API_KEY ? { Authorization: `Bearer ${LLM_API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const err = await response.text();
    log.error({ status: response.status, err }, 'LLM API error');
    throw new Error(`LLM API error: ${response.status} ${err}`);
  }

  const data = await response.json();
  const choice = data.choices?.[0];

  const result: LLMResponse = {
    content: choice?.message?.content || '',
    model: data.model || model,
    usage: {
      prompt: data.usage?.prompt_tokens || 0,
      completion: data.usage?.completion_tokens || 0,
      total: data.usage?.total_tokens || 0,
    },
    finishReason: choice?.finish_reason || 'stop',
    toolCalls: choice?.message?.tool_calls || undefined,
  };

  log.debug({ model: result.model, tokens: result.usage.total }, 'LLM response');
  return result;
}

export async function* chatCompletionStream(
  messages: ChatMessage[],
  options: LLMOptions = {}
): AsyncGenerator<string> {
  const { model = 'gemini-pro-agent', temperature = 0.7, maxTokens = 4096 } = options;

  const response = await fetch(`${LLM_API_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(LLM_API_KEY ? { Authorization: `Bearer ${LLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
  });

  if (!response.ok || !response.body) {
    throw new Error(`LLM stream error: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') return;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* skip malformed */ }
    }
  }
}

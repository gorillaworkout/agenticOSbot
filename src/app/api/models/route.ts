import { ok, err } from '@/lib/api';

const LLM_API_URL = process.env.LLM_API_URL || 'https://llm.mfah.me';
const LLM_API_KEY = process.env.LLM_API_KEY || '';

export async function GET() {
  try {
    const response = await fetch(`${LLM_API_URL}/v1/models`, {
      headers: {
        ...(LLM_API_KEY ? { Authorization: `Bearer ${LLM_API_KEY}` } : {}),
      },
    });

    if (!response.ok) {
      return err('Failed to fetch models', 502);
    }

    const data = await response.json();
    const models = (data.data || []).map((m: { id: string }) => ({
      id: m.id,
      name: m.id.replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
    }));

    return ok(models);
  } catch (e) {
    return err('Failed to fetch models: ' + String(e), 500);
  }
}

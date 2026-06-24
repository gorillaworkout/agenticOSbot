/**
 * GOR-140: Slack API client.
 * Uses OAuth connection for authenticated requests.
 */
const SLACK_API = 'https://slack.com/api';

async function slackFetch(method: string, token: string, options?: RequestInit) {
  const url = method.startsWith('http') ? method : `${SLACK_API}/${method}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const data = await res.json();
  if (!data.ok) return { error: data.error || 'Slack API error', data: null };
  return { error: null, data };
}

export async function listChannels(token: string) {
  return slackFetch('conversations.list', token, {
    method: 'GET',
  });
}

export async function getChannelHistory(token: string, channel: string, limit = 20) {
  return slackFetch(`conversations.history?channel=${channel}&limit=${limit}`, token);
}

export async function sendMessage(token: string, channel: string, text: string, threadTs?: string) {
  return slackFetch('chat.postMessage', token, {
    method: 'POST',
    body: JSON.stringify({
      channel,
      text,
      ...(threadTs && { thread_ts: threadTs }),
    }),
  });
}

export async function addReaction(token: string, channel: string, timestamp: string, name: string) {
  return slackFetch('reactions.add', token, {
    method: 'POST',
    body: JSON.stringify({ channel, timestamp, name }),
  });
}

export async function uploadFile(token: string, channels: string, file: Buffer, filename: string, title?: string) {
  const formData = new FormData();
  formData.append('channels', channels);
  formData.append('file', new Blob([new Uint8Array(file)]), filename);
  if (title) formData.append('title', title);

  const res = await fetch(`${SLACK_API}/files.upload`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: formData,
  });
  const data = await res.json();
  if (!data.ok) return { error: data.error || 'Upload failed', data: null };
  return { error: null, data };
}

export async function searchMessages(token: string, query: string, count = 20) {
  return slackFetch(`search.messages?query=${encodeURIComponent(query)}&count=${count}`, token);
}

export async function getUserInfo(token: string, userId: string) {
  return slackFetch(`users.info?user=${userId}`, token);
}

export async function getAuthTest(token: string) {
  return slackFetch('auth.test', token);
}

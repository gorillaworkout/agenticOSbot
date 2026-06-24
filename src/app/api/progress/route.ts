/**
 * GOR-108: SSE endpoint for real-time agent progress streaming.
 * GET /api/progress?connectionId=xxx
 */
import { NextRequest } from 'next/server';
import { createSSEStream, generateConnectionId } from '@/lib/sse';

export async function GET(req: NextRequest) {
  const connectionId = req.nextUrl.searchParams.get('connectionId') || generateConnectionId();
  const stream = createSSEStream(connectionId);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Connection-Id': connectionId,
    },
  });
}

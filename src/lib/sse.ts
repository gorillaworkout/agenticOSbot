/**
 * GOR-108: Server-Sent Events for real-time agent progress streaming
 * Provides live progress updates during long-running agent operations.
 */
import { NextRequest } from 'next/server';

// In-memory SSE connection store
const connections = new Map<string, ReadableStreamDefaultController>();
const progressBuffers = new Map<string, ProgressEvent[]>();

export interface ProgressEvent {
  type: 'tool_start' | 'tool_end' | 'llm_thinking' | 'llm_response' | 'error' | 'complete' | 'progress';
  data: {
    message: string;
    toolName?: string;
    round?: number;
    totalRounds?: number;
    progress?: number;  // 0-100
    timestamp: number;
  };
}

/**
 * Send a progress event to a specific connection.
 */
export function sendProgress(connectionId: string, event: ProgressEvent): void {
  const controller = connections.get(connectionId);
  if (controller) {
    try {
      const eventData = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
      controller.enqueue(new TextEncoder().encode(eventData));
    } catch {
      // Connection closed, remove it
      connections.delete(connectionId);
      progressBuffers.delete(connectionId);
    }
  }
  
  // Buffer for late subscribers
  const buffer = progressBuffers.get(connectionId) || [];
  buffer.push(event);
  if (buffer.length > 100) buffer.shift(); // Cap buffer at 100 events
  progressBuffers.set(connectionId, buffer);
}

/**
 * Create an SSE response stream for a connection.
 */
export function createSSEStream(connectionId: string): ReadableStream {
  const stream = new ReadableStream({
    start(controller) {
      connections.set(connectionId, controller);
      
      // Send buffered events
      const buffer = progressBuffers.get(connectionId) || [];
      for (const event of buffer) {
        try {
          const eventData = `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
          controller.enqueue(new TextEncoder().encode(eventData));
        } catch { break; }
      }
      
      // Send initial connection event
      sendProgress(connectionId, {
        type: 'progress',
        data: { message: 'Connected to agent progress stream', progress: 0, timestamp: Date.now() },
      });
    },
    cancel() {
      connections.delete(connectionId);
    },
  });

  return stream;
}

/**
 * Generate a unique connection ID.
 */
export function generateConnectionId(): string {
  return `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Get active connection count (for monitoring).
 */
export function getActiveConnectionCount(): number {
  return connections.size;
}

/**
 * Progress reporter helper — wraps tool execution with progress events.
 */
export function withProgress<T>(
  connectionId: string,
  toolName: string,
  round: number,
  totalRounds: number,
  fn: () => Promise<T>
): Promise<T> {
  sendProgress(connectionId, {
    type: 'tool_start',
    data: { message: `Executing ${toolName}...`, toolName, round, totalRounds, progress: Math.round((round / totalRounds) * 100), timestamp: Date.now() },
  });

  return fn().then(
    (result) => {
      sendProgress(connectionId, {
        type: 'tool_end',
        data: { message: `${toolName} completed`, toolName, round, totalRounds, progress: Math.round(((round + 1) / totalRounds) * 100), timestamp: Date.now() },
      });
      return result;
    },
    (error) => {
      sendProgress(connectionId, {
        type: 'error',
        data: { message: `${toolName} failed: ${error}`, toolName, round, totalRounds, timestamp: Date.now() },
      });
      throw error;
    }
  );
}

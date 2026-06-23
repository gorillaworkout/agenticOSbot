import { describe, it, expect } from 'vitest';

// Test the calculator tool logic (extracted from tools.ts)
function calculator(expression: string): string {
  try {
    if (!/^[\d+\-*/().%\s]+$/.test(expression)) {
      return 'Error: Only numeric expressions allowed';
    }
    const result = Function('"use strict"; return (' + expression + ')')();
    return `= ${result}`;
  } catch {
    return 'Error: Invalid expression';
  }
}

// Test parseToolCalls (extracted from tools.ts)
function parseToolCalls(content: string): { name: string; args: Record<string, unknown> }[] {
  const toolCalls: { name: string; args: Record<string, unknown> }[] = [];
  const regex = /\{"tool_call":\s*\{"name":\s*"([^"]+)",\s*"args":\s*(\{[^}]+\})\}\}/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    try {
      toolCalls.push({ name: match[1], args: JSON.parse(match[2]) });
    } catch { /* skip malformed */ }
  }
  return toolCalls;
}

describe('calculator', () => {
  it('evaluates basic arithmetic', () => {
    expect(calculator('2 + 2')).toBe('= 4');
    expect(calculator('10 * 5')).toBe('= 50');
    expect(calculator('100 / 4')).toBe('= 25');
    expect(calculator('10 - 3')).toBe('= 7');
  });

  it('handles parentheses', () => {
    expect(calculator('(2 + 3) * 4')).toBe('= 20');
  });

  it('handles decimal numbers', () => {
    expect(calculator('1.5 + 2.5')).toBe('= 4');
  });

  it('handles modulo', () => {
    expect(calculator('10 % 3')).toBe('= 1');
  });

  it('rejects non-numeric expressions', () => {
    expect(calculator('hello')).toContain('Error');
    expect(calculator('2 + abc')).toContain('Error');
  });

  it('rejects potentially dangerous expressions', () => {
    expect(calculator('process.exit()')).toContain('Error');
    expect(calculator('require("fs")')).toContain('Error');
  });
});

describe('parseToolCalls', () => {
  it('parses a single tool call', () => {
    const input = '{"tool_call": {"name": "web_search", "args": {"query": "hello"}}}';
    const result = parseToolCalls(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('web_search');
    expect(result[0].args.query).toBe('hello');
  });

  it('parses multiple tool calls', () => {
    const input = '{"tool_call": {"name": "web_search", "args": {"query": "hello"}}} some text {"tool_call": {"name": "calculator", "args": {"expression": "2+2"}}}';
    const result = parseToolCalls(input);
    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('web_search');
    expect(result[1].name).toBe('calculator');
  });

  it('returns empty array when no tool calls found', () => {
    const input = 'This is just a normal message with no tool calls.';
    const result = parseToolCalls(input);
    expect(result).toHaveLength(0);
  });

  it('skips malformed tool calls', () => {
    const input = '{"tool_call": {"name": "web_search", "args": {"query": "hello"}}} bad json here {"tool_call": {"name": "calc", "args": {invalid}}}';
    const result = parseToolCalls(input);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('web_search');
  });
});

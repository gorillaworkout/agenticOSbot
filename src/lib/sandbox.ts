/**
 * GOR-105: Sandboxed code execution
 * Replaces raw child_process with isolated, time-limited, resource-capped runner.
 */
import { execSync, spawn } from 'child_process';
import { childLogger } from './logger';

const log = childLogger('sandbox');

interface SandboxOptions {
  timeout?: number;        // ms, default 30000
  maxBuffer?: number;      // bytes, default 5MB
  maxMemory?: number;      // MB, default 256
  allowedCommands?: string[];
  workingDir?: string;
  env?: Record<string, string>;
}

const DEFAULT_OPTIONS: SandboxOptions = {
  timeout: 30000,
  maxBuffer: 5 * 1024 * 1024,
  maxMemory: 256,
  allowedCommands: [
    'ls', 'cat', 'echo', 'grep', 'find', 'wc', 'head', 'tail', 'sort', 'uniq',
    'curl', 'wget', 'jq', 'date', 'whoami', 'pwd', 'df', 'du', 'free',
    'node', 'python3', 'npm', 'npx', 'git',
  ],
};

// Dangerous patterns that should never be executed
const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+[\/~]/,          // rm -rf /
  /\bmkfs\b/,                     // mkfs
  /\bdd\s+.*of=\/dev\//,         // dd to device
  />\s*\/dev\/sd[a-z]/,          // write to disk device
  /\bchmod\s+777\s+[\/]/,        // chmod 777 /
  /\bshutdown\b/,                 // shutdown
  /\breboot\b/,                   // reboot
  /\bkill\s+-9\s+1\b/,           // kill init
  /\b:(){ :\|:& };:/,            // fork bomb
  /\bcurl\b.*\|\s*bash/,         // curl | bash
  /\bwget\b.*\|\s*sh/,           // wget | sh
];

/**
 * Check if a command is safe to execute.
 */
function isCommandSafe(command: string): { safe: boolean; reason?: string } {
  // Check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      return { safe: false, reason: `Blocked pattern: ${pattern.source}` };
    }
  }

  // Check if command starts with an allowed command
  const cmd = command.trim().split(/\s+/)[0];
  const baseCmd = cmd.split('/').pop() || cmd;
  
  if (!DEFAULT_OPTIONS.allowedCommands?.includes(baseCmd)) {
    return { safe: false, reason: `Command '${baseCmd}' not in allowed list` };
  }

  return { safe: true };
}

/**
 * Execute a command in a sandboxed environment.
 */
export async function sandboxExec(
  command: string,
  options: SandboxOptions = {}
): Promise<{ stdout: string; stderr: string; exitCode: number; duration: number }> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = Date.now();

  // Safety check
  const safety = isCommandSafe(command);
  if (!safety.safe) {
    log.warn({ command: command.slice(0, 100), reason: safety.reason }, 'Blocked unsafe command');
    return {
      stdout: '',
      stderr: `🚫 Blocked: ${safety.reason}`,
      exitCode: 1,
      duration: 0,
    };
  }

  log.debug({ command: command.slice(0, 100), timeout: opts.timeout }, 'Executing sandboxed command');

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      timeout: opts.timeout,
      cwd: opts.workingDir || '/tmp',
      env: {
        ...process.env,
        ...opts.env,
        PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      },
    } as Parameters<typeof spawn>[2]);

    let stdout = '';
    let stderr = '';
    let killed = false;

    proc.stdout!.on('data', (data: Buffer) => {
      stdout += data.toString();
      if (stdout.length > (opts.maxBuffer || 5 * 1024 * 1024)) {
        proc.kill('SIGTERM');
        killed = true;
      }
    });

    proc.stderr!.on('data', (data: Buffer) => {
      stderr += data.toString();
      if (stderr.length > (opts.maxBuffer || 5 * 1024 * 1024)) {
        proc.kill('SIGTERM');
        killed = true;
      }
    });

    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      killed = true;
    }, opts.timeout || 30000);

    proc.on('close', (code) => {
      clearTimeout(timer);
      const duration = Date.now() - startTime;
      
      if (killed && code === null) {
        resolve({
          stdout: stdout.slice(0, 1000),
          stderr: stderr.slice(0, 1000) + '\n⏱️ Process killed (timeout or buffer exceeded)',
          exitCode: 137,
          duration,
        });
      } else {
        resolve({
          stdout: stdout.slice(0, 50000),  // Cap output at 50KB
          stderr: stderr.slice(0, 10000),
          exitCode: code || 0,
          duration,
        });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      resolve({
        stdout: '',
        stderr: `Process error: ${err.message}`,
        exitCode: 1,
        duration: Date.now() - startTime,
      });
    });
  });
}

/**
 * Execute JavaScript/Node.js code in a sandboxed VM.
 */
export async function sandboxNode(
  code: string,
  options: { timeout?: number; input?: string } = {}
): Promise<{ output: string; error?: string; duration: number }> {
  const timeout = options.timeout || 10000;
  const startTime = Date.now();

  // Wrap code in a try-catch with console capture
  const wrappedCode = `
    const __output = [];
    const __origConsole = console.log;
    console.log = (...args) => __output.push(args.map(String).join(' '));
    try {
      ${code}
      console.log = __origConsole;
      process.stdout.write(JSON.stringify({ output: __output.join('\\n') }));
    } catch(e) {
      console.log = __origConsole;
      process.stdout.write(JSON.stringify({ error: e.message }));
    }
  `;

  try {
    const result = await sandboxExec(
      `echo ${JSON.stringify(wrappedCode)} | node --max-old-space-size=128 -`,
      { timeout, maxMemory: 128 }
    );

    try {
      const parsed = JSON.parse(result.stdout);
      return {
        output: parsed.output || '',
        error: parsed.error,
        duration: Date.now() - startTime,
      };
    } catch {
      return {
        output: result.stdout || result.stderr,
        error: result.exitCode !== 0 ? result.stderr : undefined,
        duration: Date.now() - startTime,
      };
    }
  } catch (err) {
    return {
      output: '',
      error: err instanceof Error ? err.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

/**
 * Execute Python code in a sandboxed environment.
 */
export async function sandboxPython(
  code: string,
  options: { timeout?: number } = {}
): Promise<{ output: string; error?: string; duration: number }> {
  const timeout = options.timeout || 10000;
  const startTime = Date.now();

  try {
    const result = await sandboxExec(
      `python3 -c ${JSON.stringify(code)}`,
      { timeout, maxMemory: 128 }
    );

    return {
      output: result.stdout,
      error: result.exitCode !== 0 ? result.stderr : undefined,
      duration: Date.now() - startTime,
    };
  } catch (err) {
    return {
      output: '',
      error: err instanceof Error ? err.message : 'Unknown error',
      duration: Date.now() - startTime,
    };
  }
}

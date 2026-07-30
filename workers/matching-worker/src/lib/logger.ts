/**
 * Structured logger for the matching-worker.
 *
 * - Production: JSON lines (one object per line) for cloud log aggregators (Fly.io, Datadog, etc.)
 * - Development: Colored, human-readable output with timing
 *
 * Every log line carries job context (deliveryId, jobId) for correlation.
 */

const IS_PROD = process.env.NODE_ENV === 'production';

// ─── ANSI Colors (dev only) ───────────────────────────────────────────────────

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

// ─── Types ────────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

type LogContext = Record<string, unknown>;

type LogEntry = {
  time: string;
  level: LogLevel;
  worker: string;
  msg: string;
  jobId?: string;
  deliveryId?: string;
  durationMs?: number;
  step?: string;
  [key: string]: unknown;
};

// ─── Formatters ───────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: C.dim,
  info: C.green,
  warn: C.yellow,
  error: C.red,
};

const LEVEL_ICONS: Record<LogLevel, string> = {
  debug: '·',
  info: '→',
  warn: '⚠',
  error: '✗',
};

function formatDev(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level];
  const icon = LEVEL_ICONS[entry.level];
  const ts = `${C.dim}${entry.time.slice(11, 23)}${C.reset}`;
  const prefix = `${color}${icon}${C.reset}`;
  const worker = `${C.cyan}[${entry.worker}]${C.reset}`;

  let line = `${ts} ${prefix} ${worker} ${entry.msg}`;

  if (entry.durationMs !== undefined) {
    const durColor = entry.durationMs > 1000 ? C.yellow : entry.durationMs > 5000 ? C.red : C.dim;
    line += ` ${durColor}(${entry.durationMs}ms)${C.reset}`;
  }

  // Append extra context fields
  const skip = new Set(['time', 'level', 'worker', 'msg', 'jobId', 'deliveryId', 'durationMs', 'step']);
  const extras = Object.entries(entry).filter(([k]) => !skip.has(k));
  if (extras.length > 0 || entry.deliveryId || entry.jobId) {
    const ctx: string[] = [];
    if (entry.deliveryId) ctx.push(`${C.dim}delivery=${C.reset}${entry.deliveryId.slice(0, 8)}`);
    if (entry.jobId) ctx.push(`${C.dim}job=${C.reset}${entry.jobId}`);
    for (const [k, v] of extras) {
      ctx.push(`${C.dim}${k}=${C.reset}${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
    line += ` ${C.dim}│${C.reset} ${ctx.join(' ')}`;
  }

  return line;
}

function formatProd(entry: LogEntry): string {
  return JSON.stringify(entry);
}

// ─── Logger Class ─────────────────────────────────────────────────────────────

export class WorkerLogger {
  private workerName: string;
  private jobId?: string;
  private deliveryId?: string;
  private baseContext: LogContext;

  constructor(workerName: string, context?: LogContext) {
    this.workerName = workerName;
    this.baseContext = context ?? {};
  }

  /**
   * Create a child logger scoped to a specific job.
   * All logs from the child include jobId and deliveryId automatically.
   */
  child(context: { jobId?: string; deliveryId?: string } & LogContext): WorkerLogger {
    const child = new WorkerLogger(this.workerName, { ...this.baseContext, ...context });
    child.jobId = context.jobId;
    child.deliveryId = context.deliveryId;
    return child;
  }

  // ─── Log Methods ──────────────────────────────────────────────────────────

  debug(msg: string, ctx?: LogContext): void {
    if (IS_PROD) return; // suppress debug in production
    this.emit('debug', msg, ctx);
  }

  info(msg: string, ctx?: LogContext): void {
    this.emit('info', msg, ctx);
  }

  warn(msg: string, ctx?: LogContext): void {
    this.emit('warn', msg, ctx);
  }

  error(msg: string, ctx?: LogContext): void {
    this.emit('error', msg, ctx);
  }

  // ─── Timing Helper ────────────────────────────────────────────────────────

  /**
   * Time an async operation and log it with duration.
   * Returns the result of the function.
   */
  async time<T>(step: string, fn: () => Promise<T>, ctx?: LogContext): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - start;
      this.emit('info', step, { ...ctx, durationMs, step });
      return result;
    } catch (err) {
      const durationMs = Date.now() - start;
      const error = err instanceof Error ? err : new Error(String(err));
      this.emit('error', `${step} FAILED`, {
        ...ctx,
        durationMs,
        step,
        error: error.message,
        stack: IS_PROD ? undefined : error.stack,
      });
      throw err;
    }
  }

  /**
   * Synchronous timer — returns start timestamp.
   * Call `logElapsed()` with the returned value when done.
   */
  startTimer(): number {
    return Date.now();
  }

  logElapsed(step: string, startedAt: number, ctx?: LogContext): void {
    const durationMs = Date.now() - startedAt;
    this.emit('info', step, { ...ctx, durationMs, step });
  }

  // ─── Internal ─────────────────────────────────────────────────────────────

  private emit(level: LogLevel, msg: string, ctx?: LogContext): void {
    const entry: LogEntry = {
      time: new Date().toISOString(),
      level,
      worker: this.workerName,
      msg,
      ...(this.jobId && { jobId: this.jobId }),
      ...(this.deliveryId && { deliveryId: this.deliveryId }),
      ...this.baseContext,
      ...ctx,
    };

    const line = IS_PROD ? formatProd(entry) : formatDev(entry);

    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const logger = new WorkerLogger('matching-worker');

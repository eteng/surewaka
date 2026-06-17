import type { MiddlewareHandler } from 'hono';
import { accessStream, apacheTimestamp, errorStream, IS_DEV } from '../lib/logger';

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function colorStatus(status: number) {
  const s = String(status);
  if (status >= 500) return `${C.red}${s}${C.reset}`;
  if (status >= 400) return `${C.yellow}${s}${C.reset}`;
  if (status >= 300) return `${C.cyan}${s}${C.reset}`;
  return `${C.green}${s}${C.reset}`;
}

function stdoutLine(method: string, path: string, status: number, ms: number, now: Date) {
  if (IS_DEV) {
    process.stdout.write(
      `${C.dim}${now.toISOString()}${C.reset} ${method} ${path} ${colorStatus(status)} ${C.dim}${ms}ms${C.reset}\n`,
    );
  } else {
    // Structured JSON for cloud log aggregation (Fly.io, etc.)
    process.stdout.write(
      JSON.stringify({ time: now.toISOString(), method, path, status, ms }) + '\n',
    );
  }
}

function apacheLine(
  ip: string,
  userId: string,
  now: Date,
  method: string,
  path: string,
  status: number,
  size: string,
  referer: string,
  ua: string,
  ms: number,
) {
  // Apache Combined Log Format + response-time extension
  return `${ip} - ${userId} [${apacheTimestamp(now)}] "${method} ${path} HTTP/1.1" ${status} ${size} "${referer}" "${ua}" ${ms}ms`;
}

function errorEntry(
  level: 'warn' | 'error' | 'fatal',
  now: Date,
  method: string,
  path: string,
  status: number,
  ms: number,
  userId: string,
  ip: string,
  ua: string,
  extra?: Record<string, unknown>,
) {
  return JSON.stringify({ time: now.toISOString(), level, method, path, status, ms, userId, ip, ua, ...extra });
}

export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const now = new Date();
  const method = c.req.method;
  const path = c.req.path;
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    '-';
  const ua = c.req.header('user-agent') ?? '-';
  const referer = c.req.header('referer') ?? '-';

  try {
    await next();

    const ms = Date.now() - start;
    const status = c.res.status;
    const size = c.res.headers.get('content-length') ?? '-';
    // user is populated by requireAuth which runs inside next()
    const userId = (c.get('user') as { id?: string } | undefined)?.id ?? '-';

    accessStream.write(apacheLine(ip, userId, now, method, path, status, size, referer, ua, ms));

    if (status >= 400) {
      errorStream.write(
        errorEntry(status >= 500 ? 'error' : 'warn', now, method, path, status, ms, userId, ip, ua),
      );
    }

    stdoutLine(method, path, status, ms, now);
  } catch (err) {
    const ms = Date.now() - start;
    const error = err instanceof Error ? err : new Error(String(err));
    const userId = (c.get('user') as { id?: string } | undefined)?.id ?? '-';

    accessStream.write(apacheLine(ip, userId, now, method, path, 500, '-', referer, ua, ms));
    errorStream.write(
      errorEntry('fatal', now, method, path, 500, ms, userId, ip, ua, {
        error: error.message,
        stack: error.stack,
      }),
    );

    stdoutLine(method, path, 500, ms, now);
    throw err;
  }
};

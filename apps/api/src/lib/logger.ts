import { createWriteStream, mkdirSync, readdirSync, rmSync } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const IS_DEV = process.env.NODE_ENV !== 'production';

// Resolve repo root from source file location — works regardless of CWD.
// src/lib/logger.ts → 4 levels up → monorepo root → logs/api
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const LOG_ROOT = process.env.LOG_DIR ? resolve(process.env.LOG_DIR) : join(REPO_ROOT, 'logs', 'api');

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function dateTag(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function apacheTimestamp(d = new Date()) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${pad(d.getDate())}/${months[d.getMonth()]}/${d.getFullYear()}:${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} +0000`;
}

// Deletes log files older than retainDays on startup to keep the directory bounded.
function pruneOldLogs(dir: string, retainDays: number) {
  try {
    const cutoff = Date.now() - retainDays * 86_400_000;
    for (const file of readdirSync(dir)) {
      const match = /^(\d{4}-\d{2}-\d{2})\.log$/.exec(file);
      if (match && new Date(match[1]).getTime() < cutoff) {
        rmSync(join(dir, file));
      }
    }
  } catch {
    // dir may not exist yet on first run
  }
}

class DailyRotatingStream {
  private stream: WriteStream | null = null;
  private currentDay = '';

  constructor(
    private readonly dir: string,
    retainDays = 14,
  ) {
    if (!IS_DEV) return;
    mkdirSync(dir, { recursive: true });
    pruneOldLogs(dir, retainDays);
  }

  write(line: string): void {
    if (!IS_DEV) return;
    const day = dateTag();
    if (day !== this.currentDay) {
      this.stream?.end();
      this.stream = createWriteStream(join(this.dir, `${day}.log`), { flags: 'a' });
      this.currentDay = day;
    }
    this.stream!.write(line + '\n');
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}

export const accessStream = new DailyRotatingStream(join(LOG_ROOT, 'access'));
export const errorStream = new DailyRotatingStream(join(LOG_ROOT, 'error'));

function shutdown() {
  accessStream.close();
  errorStream.close();
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

import { createServer, type Server } from 'node:http';
import type { Queue } from 'bullmq';

// ─── Rolling Window Metrics ──────────────────────────────────────────────────

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes

type MetricEntry = { timestamp: number };

const metrics = {
  transactional: {
    processed: [] as MetricEntry[],
    failed: [] as MetricEntry[],
  },
  broadcast: {
    processed: [] as MetricEntry[],
    failed: [] as MetricEntry[],
  },
};

function pruneOldEntries(entries: MetricEntry[]): MetricEntry[] {
  const cutoff = Date.now() - WINDOW_MS;
  // Find first entry within window (entries are chronological)
  const idx = entries.findIndex((e) => e.timestamp >= cutoff);
  if (idx === -1) return [];
  if (idx === 0) return entries;
  entries.splice(0, idx);
  return entries;
}

function getProcessedPerMinute(queue: 'transactional' | 'broadcast'): number {
  const entries = pruneOldEntries(metrics[queue].processed);
  if (entries.length === 0) return 0;
  // Average per minute over the 5-min window
  return Math.round((entries.length / 5) * 100) / 100;
}

function getFailureRate(queue: 'transactional' | 'broadcast'): number {
  const processed = pruneOldEntries(metrics[queue].processed);
  const failed = pruneOldEntries(metrics[queue].failed);
  const total = processed.length + failed.length;
  if (total === 0) return 0;
  return Math.round((failed.length / total) * 10000) / 10000; // 4 decimal places
}

// ─── Public Recording Functions ──────────────────────────────────────────────

export function recordProcessed(queue: 'transactional' | 'broadcast'): void {
  metrics[queue].processed.push({ timestamp: Date.now() });
}

export function recordFailed(queue: 'transactional' | 'broadcast'): void {
  metrics[queue].failed.push({ timestamp: Date.now() });
}

// ─── Health Server ───────────────────────────────────────────────────────────

export function startHealthServer(
  transactionalQueue: Queue,
  broadcastQueue: Queue,
): Server {
  const port = Number(process.env.PUSH_WORKER_HEALTH_PORT) || 4001;

  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      try {
        const [txWaiting, txActive, bcWaiting, bcActive] = await Promise.all([
          transactionalQueue.getWaitingCount(),
          transactionalQueue.getActiveCount(),
          broadcastQueue.getWaitingCount(),
          broadcastQueue.getActiveCount(),
        ]);

        const txFailureRate = getFailureRate('transactional');
        const bcFailureRate = getFailureRate('broadcast');

        // Degraded if either queue has high depth or high failure rate
        const isDegraded =
          txWaiting + txActive > 1000 ||
          bcWaiting + bcActive > 500 ||
          txFailureRate > 0.5 ||
          bcFailureRate > 0.5;

        const body = JSON.stringify({
          status: isDegraded ? 'degraded' : 'healthy',
          transactional: {
            depth: txWaiting + txActive,
            processedPerMinute: getProcessedPerMinute('transactional'),
            failureRate: txFailureRate,
          },
          broadcast: {
            depth: bcWaiting + bcActive,
            processedPerMinute: getProcessedPerMinute('broadcast'),
            failureRate: bcFailureRate,
          },
          timestamp: new Date().toISOString(),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', error: message }));
      }
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not Found' }));
    }
  });

  server.listen(port, () => {
    console.log(`🏥 Health check server listening on port ${port}`);
  });

  return server;
}

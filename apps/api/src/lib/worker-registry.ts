/**
 * Worker Registry for the Admin Dashboard.
 *
 * Complements queue-registry.ts: BullMQ queues tell us jobs are waiting, but
 * not whether a live process is actually consuming them. This registry polls
 * each worker's own HTTP /health endpoint (reachable over Fly's private 6PN
 * network at <fly-app>.internal since these ports aren't publicly proxied),
 * and separately tracks "stub" workers that exist in the repo but have no
 * process wired up to run them at all.
 */

export type WorkerStatus = 'ok' | 'degraded' | 'unhealthy' | 'unreachable' | 'stub';

export type WorkerHealth = {
  name: string;
  displayName: string;
  status: WorkerStatus;
  detail: Record<string, unknown> | null;
  checkedAt: string;
  error: string | null;
};

type WorkerDef =
  | { name: string; displayName: string; kind: 'health-endpoint'; healthUrl: string }
  | { name: string; displayName: string; kind: 'stub'; note: string };

const HEALTH_TIMEOUT_MS = 3000;

const WORKERS: WorkerDef[] = [
  {
    name: 'alert-engine',
    displayName: 'Alert Engine',
    kind: 'health-endpoint',
    healthUrl: process.env.ALERT_ENGINE_HEALTH_URL ?? 'http://surewaka-workers.internal:4005/health',
  },
  {
    name: 'email-worker',
    displayName: 'Email Worker',
    kind: 'stub',
    note: 'processEmailJob is exported but nothing invokes it — not wired to a queue, scheduler, or trigger yet.',
  },
  {
    name: 'agent-worker',
    displayName: 'Agent Worker',
    kind: 'stub',
    note: 'processAgentTask is exported but nothing invokes it — not wired to a queue, scheduler, or trigger yet.',
  },
];

async function checkWorker(def: WorkerDef): Promise<WorkerHealth> {
  const checkedAt = new Date().toISOString();

  if (def.kind === 'stub') {
    return {
      name: def.name,
      displayName: def.displayName,
      status: 'stub',
      detail: { note: def.note },
      checkedAt,
      error: null,
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

  try {
    const res = await fetch(def.healthUrl, { signal: controller.signal });
    const body = await res.json().catch(() => null) as Record<string, unknown> | null;

    if (!res.ok && res.status !== 503) {
      return { name: def.name, displayName: def.displayName, status: 'unreachable', detail: body, checkedAt, error: `HTTP ${res.status}` };
    }

    const reportedStatus = body?.status;
    const status: WorkerStatus =
      reportedStatus === 'unhealthy' ? 'unhealthy' :
      reportedStatus === 'degraded' ? 'degraded' :
      'ok';

    return { name: def.name, displayName: def.displayName, status, detail: body, checkedAt, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { name: def.name, displayName: def.displayName, status: 'unreachable', detail: null, checkedAt, error: message };
  } finally {
    clearTimeout(timeout);
  }
}

export async function getWorkerHealth(): Promise<WorkerHealth[]> {
  return Promise.all(WORKERS.map(checkWorker));
}

/**
 * Queue Dashboard Hooks — data fetching + real-time SSE updates.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueCounts = {
  active: number;
  waiting: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  prioritized: number;
};

export type QueueInfo = {
  name: string;
  displayName: string;
  description: string;
  isPaused: boolean;
  counts: QueueCounts;
  totalFailed: number;
  totalActive: number;
  workers: {
    count: number;
    instances: Record<string, string>[];
  };
};

export type JobInfo = {
  id: string;
  name: string;
  data: Record<string, unknown>;
  opts: Record<string, unknown>;
  timestamp: number;
  processedOn: number | null;
  finishedOn: number | null;
  attemptsMade: number;
  failedReason: string | null;
  stacktrace: string[];
  returnvalue: unknown;
  progress: number | object | null;
  delay: number;
};

export type JobDetail = JobInfo & {
  state: string;
  logs: string[];
  logsCount: number;
};

export type JobStatus = 'active' | 'waiting' | 'completed' | 'failed' | 'delayed' | 'paused' | 'prioritized';

export type SSEEvent = {
  type: 'job:completed' | 'job:failed' | 'job:active' | 'job:waiting' | 'job:stalled';
  queue: string;
  jobId: string;
  failedReason?: string;
  returnvalue?: string;
};

export type WorkerStatus = 'ok' | 'degraded' | 'unhealthy' | 'unreachable' | 'stub';

export type WorkerHealth = {
  name: string;
  displayName: string;
  status: WorkerStatus;
  detail: Record<string, unknown> | null;
  checkedAt: string;
  error: string | null;
};

// ─── Auth Header Helper ───────────────────────────────────────────────────────

function authHeaders(token: string | null): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// ─── useQueues — fetch all queues with counts ─────────────────────────────────

export function useQueues() {
  const { getToken } = useAuth();
  const [queues, setQueues] = useState<QueueInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchQueues = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/queues`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: QueueInfo[] };
      setQueues(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queues');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchQueues();
  }, [fetchQueues]);

  return { queues, isLoading, error, refetch: fetchQueues };
}

// ─── useWorkerHealth — non-queue worker state (health-endpoint + stub) ────────

export function useWorkerHealth() {
  const { getToken } = useAuth();
  const [workers, setWorkers] = useState<WorkerHealth[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkers = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/queues/workers`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: WorkerHealth[] };
      setWorkers(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load worker status');
    } finally {
      setIsLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    fetchWorkers();
  }, [fetchWorkers]);

  return { workers, isLoading, error, refetch: fetchWorkers };
}

// ─── useQueueJobs — paginated jobs by status ──────────────────────────────────

export function useQueueJobs(queueName: string, status: JobStatus = 'active', page = 1, limit = 20) {
  const { getToken } = useAuth();
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [meta, setMeta] = useState<{ page: number; limit: number; total: number; totalPages: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchJobs = useCallback(async () => {
    setIsLoading(true);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ status, page: String(page), limit: String(limit) });
      const res = await fetch(`${API_URL}/api/v1/admin/queues/${queueName}/jobs?${params}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: JobInfo[]; meta: typeof meta };
      setJobs(body.data);
      setMeta(body.meta);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setIsLoading(false);
    }
  }, [getToken, queueName, status, page, limit]);

  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  return { jobs, meta, isLoading, error, refetch: fetchJobs };
}

// ─── useJobDetail — single job with full payload ──────────────────────────────

export function useJobDetail(queueName: string, jobId: string | null) {
  const { getToken } = useAuth();
  const [job, setJob] = useState<JobDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchJob = useCallback(async () => {
    if (!jobId) return;
    setIsLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/queues/${queueName}/jobs/${jobId}`, {
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: JobDetail };
      setJob(body.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load job');
    } finally {
      setIsLoading(false);
    }
  }, [getToken, queueName, jobId]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  return { job, isLoading, error, refetch: fetchJob };
}

// ─── useQueueActions — retry, remove, clean, pause/resume ─────────────────────

export function useQueueActions() {
  const { getToken } = useAuth();
  const [isActing, setIsActing] = useState(false);

  const retryJob = useCallback(async (queueName: string, jobId: string) => {
    setIsActing(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/queues/${queueName}/jobs/${jobId}/retry`, {
        method: 'POST',
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch {
      return false;
    } finally {
      setIsActing(false);
    }
  }, [getToken]);

  const removeJob = useCallback(async (queueName: string, jobId: string) => {
    setIsActing(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/queues/${queueName}/jobs/${jobId}`, {
        method: 'DELETE',
        headers: authHeaders(token),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return true;
    } catch {
      return false;
    } finally {
      setIsActing(false);
    }
  }, [getToken]);

  const cleanQueue = useCallback(async (queueName: string, status: string, grace = 0) => {
    setIsActing(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/queues/${queueName}/clean`, {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, grace }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { data: { removed: number } };
      return body.data.removed;
    } catch {
      return 0;
    } finally {
      setIsActing(false);
    }
  }, [getToken]);

  const pauseQueue = useCallback(async (queueName: string) => {
    const token = await getToken();
    const res = await fetch(`${API_URL}/api/v1/admin/queues/${queueName}/pause`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    return res.ok;
  }, [getToken]);

  const resumeQueue = useCallback(async (queueName: string) => {
    const token = await getToken();
    const res = await fetch(`${API_URL}/api/v1/admin/queues/${queueName}/resume`, {
      method: 'POST',
      headers: authHeaders(token),
    });
    return res.ok;
  }, [getToken]);

  return { retryJob, removeJob, cleanQueue, pauseQueue, resumeQueue, isActing };
}

// ─── useQueueSSE — real-time event stream ─────────────────────────────────────

export function useQueueSSE(onEvent: (event: SSEEvent) => void) {
  const { getToken } = useAuth();
  const eventSourceRef = useRef<EventSource | null>(null);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      const token = await getToken();
      if (cancelled) return;

      // EventSource doesn't support custom headers, so we pass token as query param
      // The SSE endpoint already uses requireAuth middleware which reads from Authorization header
      // We'll use a proxy approach: fetch with auth to get initial connection, then use standard SSE
      const url = `${API_URL}/api/v1/admin/queues/events`;

      // Use fetch-based SSE for auth support
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      });

      if (!response.ok || !response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        let currentEvent = '';
        let currentData = '';

        for (const line of lines) {
          if (line.startsWith('event:')) {
            currentEvent = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            currentData = line.slice(5).trim();
          } else if (line === '' && currentEvent && currentData) {
            // Dispatch event
            if (currentEvent.startsWith('job:')) {
              try {
                const parsed = JSON.parse(currentData);
                onEventRef.current({
                  type: currentEvent as SSEEvent['type'],
                  ...parsed,
                });
              } catch {
                // Ignore parse errors
              }
            }
            currentEvent = '';
            currentData = '';
          }
        }
      }

      reader.releaseLock();
    }

    connect().catch(() => {
      // Reconnect after 5s on error
      if (!cancelled) {
        setTimeout(connect, 5000);
      }
    });

    return () => {
      cancelled = true;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [getToken]);
}

import { useState, useCallback, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { Pause, Play, RefreshCw, Search, Server, XCircle } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { cn } from '~/lib/utils';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Skeleton } from '~/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import {
  useQueues,
  useQueueActions,
  useQueueSSE,
  useWorkerHealth,
  type SSEEvent,
  type QueueInfo,
  type WorkerHealth,
  type WorkerStatus,
} from '~/hooks/use-queues';
import { useAuth } from '@clerk/react';
import type { Route } from './+types/queues';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export function meta({}: Route.MetaArgs) {
  return [{ title: 'SureWaka Admin - Queue Dashboard' }];
}

// ─── Types ────────────────────────────────────────────────────────────────────

type MetricsData = {
  redis: {
    version: string;
    connections: number;
    usedMemoryHuman: string;
    usedCpuSys: string;
  };
  throughputPerMin: number;
  failRate: number;
  totalJobs7d: number;
  queues: Array<{
    name: string;
    completed: number[];
    failed: number[];
    totalCompleted: number;
    totalFailed: number;
  }>;
};

// ─── Loading Skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function QueuesOverview() {
  const { queues, isLoading, error, refetch } = useQueues();
  const { pauseQueue, resumeQueue } = useQueueActions();
  const [metrics, setMetrics] = useState<MetricsData | null>(null);
  const [period, setPeriod] = useState<'day' | 'month'>('day');
  const [search, setSearch] = useState('');
  const [lastEvent, setLastEvent] = useState<SSEEvent | null>(null);
  const { getToken } = useAuth();

  // Fetch metrics
  const fetchMetrics = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_URL}/api/v1/admin/queues/metrics?period=${period}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const body = await res.json() as { data: MetricsData };
        setMetrics(body.data);
      }
    } catch {
      // Metrics are optional — don't block the page
    }
  }, [getToken, period]);

  useEffect(() => { fetchMetrics(); }, [fetchMetrics]);

  // Real-time SSE updates
  const handleSSEEvent = useCallback((event: SSEEvent) => {
    setLastEvent(event);
    refetch();
  }, [refetch]);
  useQueueSSE(handleSSEEvent);

  // Aggregate stats
  const stats = useMemo(() => {
    const total = queues.reduce((s, q) => s + q.counts.active + q.counts.waiting + q.counts.completed + q.counts.failed + q.counts.delayed + q.counts.paused, 0);
    const waiting = queues.reduce((s, q) => s + q.counts.waiting, 0);
    const active = queues.reduce((s, q) => s + q.counts.active, 0);
    const completed = queues.reduce((s, q) => s + q.counts.completed, 0);
    const failed = queues.reduce((s, q) => s + q.counts.failed, 0);
    const delayed = queues.reduce((s, q) => s + q.counts.delayed, 0);
    const paused = queues.reduce((s, q) => s + q.counts.paused, 0);
    return { total, waiting, active, completed, failed, delayed, paused };
  }, [queues]);

  // Filter queues
  const filteredQueues = useMemo(() => {
    if (!search) return queues;
    return queues.filter((q) => q.displayName.toLowerCase().includes(search.toLowerCase()));
  }, [queues, search]);

  if (isLoading) return <LoadingSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border py-16">
        <XCircle className="mb-2 h-6 w-6 text-destructive" />
        <p className="mb-4 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Queues</h1>
          <p className="text-sm text-muted-foreground">Monitor all registered BullMQ queues</p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as 'day' | 'month')}>
          <SelectTrigger className="w-[130px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="day">Last day</SelectItem>
            <SelectItem value="month">Last month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ─── Metrics Cards ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {/* Redis Instance */}
        <div className="rounded-xl border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <Server className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Redis instance</span>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Version</p>
              <p className="text-sm font-bold tabular-nums">{metrics?.redis.version ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Connections</p>
              <p className="text-sm font-bold tabular-nums">{metrics?.redis.connections ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">CPU</p>
              <p className="text-sm font-bold tabular-nums">{metrics?.redis.usedCpuSys ?? '—'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase text-muted-foreground">Memory</p>
              <p className="text-sm font-bold tabular-nums">{metrics?.redis.usedMemoryHuman ?? '—'}</p>
            </div>
          </div>
        </div>

        {/* Throughput */}
        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Throughput</p>
          <p className="mt-1 text-xl font-bold tabular-nums lg:text-2xl">
            {metrics?.throughputPerMin ?? 0}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">jobs/min</span>
          </p>
        </div>

        {/* Fail Rate */}
        <div className="rounded-xl border bg-card p-5">
          <p className="text-sm text-muted-foreground">Fail rate</p>
          <p className={cn('mt-1 text-xl font-bold tabular-nums lg:text-2xl', metrics && metrics.failRate > 5 && 'text-red-600 dark:text-red-400')}>
            {metrics?.failRate ?? 0}%
          </p>
          <p className={cn('mt-0.5 text-xs', metrics && metrics.failRate > 5 ? 'text-red-500' : 'text-muted-foreground')}>
            {metrics?.totalJobs7d.toLocaleString() ?? 0} jobs past 7 days
          </p>
        </div>
      </div>

      {/* ─── Aggregate Stats ─────────────────────────────────────────── */}
      <div className="rounded-xl border bg-card p-5">
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-7">
          <StatCell label="Total" value={stats.total} dot="bg-muted-foreground" />
          <StatCell label="Waiting" value={stats.waiting} dot="bg-amber-500" />
          <StatCell label="Active" value={stats.active} dot="bg-blue-500" />
          <StatCell label="Completed" value={stats.completed} dot="bg-green-500" />
          <StatCell label="Failed" value={stats.failed} dot="bg-red-500" />
          <StatCell label="Delayed" value={stats.delayed} dot="bg-purple-500" />
          <StatCell label="Paused" value={stats.paused} dot="bg-muted-foreground/50" />
        </div>
      </div>

      {/* ─── Time-Series Chart ──────────────────────────────────────── */}
      {metrics && <ThroughputChart metrics={metrics} />}

      {/* ─── Queue Table ────────────────────────────────────────────── */}
      <section className="rounded-xl border bg-card">
        <div className="flex items-center justify-between gap-3 border-b p-4">
          <h2 className="text-sm font-semibold">Queues</h2>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder="Search"
              className="pl-8 h-9 text-sm"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search queues"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Queue</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead className="text-right">Completed</TableHead>
                <TableHead className="text-right">Workers</TableHead>
                <TableHead className="w-10 text-right sr-only">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredQueues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-12 text-center text-sm text-muted-foreground">
                    No queues match "{search}".
                  </TableCell>
                </TableRow>
              ) : (
                filteredQueues.map((queue) => (
                  <QueueRow
                    key={queue.name}
                    queue={queue}
                    onPause={() => pauseQueue(queue.name).then(() => refetch())}
                    onResume={() => resumeQueue(queue.name).then(() => refetch())}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ─── Workers ─────────────────────────────────────────────────── */}
      <WorkersSection />

      {/* SSE Status */}
      {lastEvent && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
          </span>
          Connected — live
        </div>
      )}
    </div>
  );
}

// ─── Queue Table Row ──────────────────────────────────────────────────────────

const PAUSED_BADGE = 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';

function QueueRow({ queue, onPause, onResume }: { queue: QueueInfo; onPause: () => void; onResume: () => void }) {
  const navigate = useNavigate();
  const total = queue.counts.active + queue.counts.waiting + queue.counts.failed + queue.counts.delayed + queue.counts.completed;
  const goToQueue = () => navigate(`/queues/${queue.name}`);

  return (
    <TableRow
      className="cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={goToQueue}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goToQueue();
        }
      }}
      tabIndex={0}
      role="row"
      aria-label={`Queue: ${queue.displayName}`}
    >
      <TableCell>
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{queue.displayName}</span>
          {queue.isPaused && (
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', PAUSED_BADGE)}>Paused</span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right font-mono text-sm tabular-nums">{total.toLocaleString()}</TableCell>
      <TableCell className="text-right font-mono text-sm tabular-nums">{queue.counts.active}</TableCell>
      <TableCell className="text-right font-mono text-sm tabular-nums">
        <span className={queue.counts.failed > 0 ? 'font-semibold text-red-600 dark:text-red-400' : ''}>
          {queue.counts.failed}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-sm tabular-nums">{queue.counts.completed.toLocaleString()}</TableCell>
      <TableCell className="text-right">
        <WorkerDots count={queue.workers.count} />
      </TableCell>
      <TableCell className="text-right">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          aria-label={queue.isPaused ? `Resume ${queue.displayName}` : `Pause ${queue.displayName}`}
          onClick={(e) => {
            e.stopPropagation();
            queue.isPaused ? onResume() : onPause();
          }}
        >
          {queue.isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ─── Worker Dots ──────────────────────────────────────────────────────────────

function WorkerDots({ count }: { count: number }) {
  if (count === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center justify-end gap-0.5" aria-label={`${count} workers online`}>
      {Array.from({ length: Math.min(count, 10) }).map((_, i) => (
        <span key={i} className="inline-block h-2 w-2 rounded-full bg-green-500" />
      ))}
      {count > 10 && <span className="ml-1 text-[10px] text-muted-foreground">+{count - 10}</span>}
    </div>
  );
}

// ─── Stat Cell ────────────────────────────────────────────────────────────────

function StatCell({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5">
        <span className={cn('h-2 w-2 rounded-full', dot)} aria-hidden="true" />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

// ─── Workers Section ──────────────────────────────────────────────────────────

const WORKER_STATUS_STYLES: Record<WorkerStatus, string> = {
  ok: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  degraded: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  unhealthy: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  unreachable: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  stub: 'bg-muted text-muted-foreground',
};

const WORKER_STATUS_LABELS: Record<WorkerStatus, string> = {
  ok: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unreachable: 'Unreachable',
  stub: 'Not wired up',
};

function WorkersSection() {
  const { workers, isLoading, error, refetch } = useWorkerHealth();

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b p-4">
        <div>
          <h2 className="text-sm font-semibold">Workers</h2>
          <p className="text-xs text-muted-foreground">Processes and stub functions outside the BullMQ queues above</p>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refetch} aria-label="Refresh worker status">
          <RefreshCw className="h-3 w-3" />
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3 p-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
        </div>
      ) : (
        <ul className="divide-y">
          {workers.map((w) => <WorkerRow key={w.name} worker={w} />)}
        </ul>
      )}
    </section>
  );
}

function WorkerRow({ worker }: { worker: WorkerHealth }) {
  const detail = worker.detail;

  return (
    <li className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{worker.displayName}</span>
          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', WORKER_STATUS_STYLES[worker.status])}>
            {WORKER_STATUS_LABELS[worker.status]}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {worker.status === 'stub' && typeof detail?.note === 'string'
            ? detail.note
            : worker.status === 'unreachable'
              ? (worker.error ?? 'Health check failed')
              : typeof detail?.msSinceLastTick === 'number'
                ? `Last tick ${formatRelativeMs(detail.msSinceLastTick)} ago`
                : 'No tick recorded yet'}
        </p>
        {worker.status !== 'stub' && typeof detail?.lastError === 'string' && (
          <p className="mt-0.5 truncate text-xs text-red-600 dark:text-red-400">{detail.lastError}</p>
        )}
      </div>
    </li>
  );
}

function formatRelativeMs(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  return `${hours}h`;
}

// ─── Throughput Chart ─────────────────────────────────────────────────────────

function ThroughputChart({ metrics }: { metrics: MetricsData }) {
  const chartData = useMemo(() => {
    const maxLen = Math.max(...metrics.queues.map((q) => q.completed.length), 0);
    const points: Array<{ i: number; completed: number; failed: number }> = [];
    for (let i = 0; i < maxLen; i++) {
      const completed = metrics.queues.reduce((s, q) => s + (q.completed[i] ?? 0), 0);
      const failed = metrics.queues.reduce((s, q) => s + (q.failed[i] ?? 0), 0);
      points.push({ i, completed, failed });
    }
    return points.reverse();
  }, [metrics]);

  return (
    <section className="rounded-xl border bg-card p-5" aria-label="Job throughput over time">
      <h3 className="text-sm font-semibold">Job Throughput</h3>
      {chartData.length < 2 ? (
        <div className="flex h-52 items-center justify-center">
          <p className="text-sm text-muted-foreground">No throughput data yet.</p>
        </div>
      ) : (
        <div role="img" aria-label="Line chart showing completed and failed jobs over time">
          <ResponsiveContainer width="100%" height={220} className="mt-4">
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
              <XAxis dataKey="i" tick={false} axisLine={false} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line dataKey="completed" name="Completed" stroke="#16a34a" strokeWidth={2} dot={false} />
              <Line dataKey="failed" name="Failed" stroke="#ef4444" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </section>
  );
}

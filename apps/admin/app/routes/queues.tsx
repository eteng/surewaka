import { useState, useCallback, useEffect, useMemo } from 'react';
import { Link } from 'react-router';
import {
  Activity,
  AlertTriangle,
  ChevronRight,
  Pause,
  Play,
  RefreshCw,
  Search,
  Server,
  XCircle,
} from 'lucide-react';
import { Badge } from '~/components/ui/badge';
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
import { useQueues, useQueueActions, useQueueSSE, type SSEEvent, type QueueInfo } from '~/hooks/use-queues';
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

  if (isLoading) return <PageSkeleton />;

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
        <XCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-0 bg-background">
      {/* ─── Metrics Bar (dark panel) ─────────────────────────────────── */}
      <div className="border-b bg-muted/50 px-6 py-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Redis Instance */}
          <div className="rounded-lg border border bg-card px-4 py-3">
            <div className="flex items-center gap-2 mb-2">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Redis instance</span>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Version</p>
                <p className="text-sm font-bold text-foreground">{metrics?.redis.version ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Connections</p>
                <p className="text-sm font-bold text-foreground">{metrics?.redis.connections ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">CPU</p>
                <p className="text-sm font-bold text-foreground">{metrics?.redis.usedCpuSys ?? '—'}</p>
              </div>
              <div>
                <p className="text-[10px] text-muted-foreground uppercase">Memory</p>
                <p className="text-sm font-bold text-foreground">{metrics?.redis.usedMemoryHuman ?? '—'}</p>
              </div>
            </div>
          </div>

          {/* Throughput */}
          <div className="rounded-lg border border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">Throughput</p>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold text-foreground">{metrics?.throughputPerMin ?? 0}</span>
              <span className="text-xs text-muted-foreground">jobs/min</span>
              {/* Mini sparkline using inline SVG */}
              <SparkLine data={metrics?.queues[0]?.completed.slice(0, 30) ?? []} className="ml-auto" />
            </div>
          </div>

          {/* Fail Rate */}
          <div className="rounded-lg border border bg-card px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">Fail rate</p>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-bold ${metrics && metrics.failRate > 5 ? 'text-destructive' : 'text-foreground'}`}>
                {metrics?.failRate ?? 0}%
              </span>
              <span className="text-xs text-muted-foreground">
                ({metrics?.totalJobs7d.toLocaleString() ?? 0} jobs past 7 days)
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ─── Content Area ─────────────────────────────────────────────── */}
      <div className="flex-1 px-6 py-6 space-y-6">
        {/* Period selector */}
        <div className="flex justify-end">
          <Select value={period} onValueChange={(v) => setPeriod(v as 'day' | 'month')}>
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day">Last day</SelectItem>
              <SelectItem value="month">Last month</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ─── Aggregate Stats Row ────────────────────────────────────── */}
        <div className="grid grid-cols-3 sm:grid-cols-7 gap-4 border-b pb-6">
          <StatCell label="Total" value={stats.total} dot="bg-muted-foreground" />
          <StatCell label="Waiting" value={stats.waiting} dot="bg-amber-500" />
          <StatCell label="Active" value={stats.active} dot="bg-blue-500" />
          <StatCell label="Completed" value={stats.completed} dot="bg-green-500" />
          <StatCell label="Failed" value={stats.failed} dot="bg-red-500" />
          <StatCell label="Delayed" value={stats.delayed} dot="bg-purple-500" />
          <StatCell label="Paused" value={stats.paused} dot="bg-muted-foreground/50" />
        </div>

        {/* ─── Time-Series Chart ──────────────────────────────────────── */}
        {metrics && <TimeSeriesChart metrics={metrics} period={period} />}

        {/* ─── Queue Table ────────────────────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold">Queues</h2>
              <p className="text-xs text-muted-foreground">
                Monitor all registered BullMQ queues
              </p>
            </div>
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search"
                className="pl-8 h-9 text-sm"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs font-medium">Queue</TableHead>
                  <TableHead className="text-xs font-medium text-right">Total</TableHead>
                  <TableHead className="text-xs font-medium text-right">Active</TableHead>
                  <TableHead className="text-xs font-medium text-right">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                      Failed
                    </span>
                  </TableHead>
                  <TableHead className="text-xs font-medium text-right">Completed</TableHead>
                  <TableHead className="text-xs font-medium text-right">
                    <span className="inline-flex items-center gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Workers
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQueues.map((queue) => (
                  <QueueRow
                    key={queue.name}
                    queue={queue}
                    onPause={() => pauseQueue(queue.name).then(() => refetch())}
                    onResume={() => resumeQueue(queue.name).then(() => refetch())}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* SSE Status */}
        {lastEvent && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5 pt-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            Connected — live
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Queue Table Row ──────────────────────────────────────────────────────────

function QueueRow({ queue, onPause, onResume }: { queue: QueueInfo; onPause: () => void; onResume: () => void }) {
  const total = queue.counts.active + queue.counts.waiting + queue.counts.failed + queue.counts.delayed + queue.counts.completed;

  return (
    <TableRow className="cursor-pointer group">
      <TableCell>
        <Link to={`/queues/${queue.name}`} className="flex items-center gap-2">
          <span className="font-medium text-sm group-hover:text-primary transition-colors">
            {queue.displayName}
          </span>
          {queue.isPaused && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-yellow-600 border-yellow-300">
              Paused
            </Badge>
          )}
        </Link>
      </TableCell>
      <TableCell className="text-right font-mono text-sm">{total.toLocaleString()}</TableCell>
      <TableCell className="text-right font-mono text-sm">{queue.counts.active}</TableCell>
      <TableCell className="text-right font-mono text-sm">
        <span className={queue.counts.failed > 0 ? 'text-red-500 font-semibold' : ''}>
          {queue.counts.failed}
        </span>
      </TableCell>
      <TableCell className="text-right font-mono text-sm">{queue.counts.completed.toLocaleString()}</TableCell>
      <TableCell className="text-right">
        <WorkerDots count={queue.workers.count} />
      </TableCell>
    </TableRow>
  );
}

// ─── Worker Dots (Kuue-style) ─────────────────────────────────────────────────

function WorkerDots({ count }: { count: number }) {
  if (count === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div className="flex items-center justify-end gap-0.5">
      {Array.from({ length: Math.min(count, 10) }).map((_, i) => (
        <span key={i} className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
      ))}
      {count > 10 && <span className="text-[10px] text-muted-foreground ml-1">+{count - 10}</span>}
    </div>
  );
}

// ─── Stat Cell ────────────────────────────────────────────────────────────────

function StatCell({ label, value, dot }: { label: string; value: number; dot: string }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value.toLocaleString()}</p>
    </div>
  );
}

// ─── SparkLine (inline SVG) ───────────────────────────────────────────────────

function SparkLine({ data, className }: { data: number[]; className?: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const width = 60;
  const height = 20;
  const points = data.map((v, i) => `${(i / (data.length - 1)) * width},${height - (v / max) * height}`).join(' ');

  return (
    <svg width={width} height={height} className={className} aria-hidden="true">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" points={points} />
    </svg>
  );
}

// ─── Time-Series Chart (SVG) ──────────────────────────────────────────────────

function TimeSeriesChart({ metrics, period }: { metrics: MetricsData; period: string }) {
  // Aggregate all queues' data into per-status time series
  const maxPoints = period === 'day' ? 48 : 60; // Downsample: 48 points for day (30-min buckets), 60 for month

  const aggregate = useCallback((data: number[], bucketSize: number) => {
    const result: number[] = [];
    for (let i = 0; i < data.length; i += bucketSize) {
      const bucket = data.slice(i, i + bucketSize);
      result.push(bucket.reduce((s, v) => s + v, 0));
    }
    return result.slice(0, maxPoints).reverse(); // Reverse so time flows left→right
  }, [maxPoints]);

  const bucketSize = period === 'day' ? 30 : 60 * 24; // 30-min or 1-day buckets

  // Sum across all queues
  const completedSeries = useMemo(() => {
    const maxLen = Math.max(...metrics.queues.map((q) => q.completed.length));
    const summed = new Array(maxLen).fill(0);
    for (const q of metrics.queues) {
      for (let i = 0; i < q.completed.length; i++) summed[i] += q.completed[i];
    }
    return aggregate(summed, bucketSize);
  }, [metrics, aggregate, bucketSize]);

  const failedSeries = useMemo(() => {
    const maxLen = Math.max(...metrics.queues.map((q) => q.failed.length));
    const summed = new Array(maxLen).fill(0);
    for (const q of metrics.queues) {
      for (let i = 0; i < q.failed.length; i++) summed[i] += q.failed[i];
    }
    return aggregate(summed, bucketSize);
  }, [metrics, aggregate, bucketSize]);

  const allValues = [...completedSeries, ...failedSeries];
  const max = Math.max(...allValues, 1);
  const W = 700;
  const H = 180;
  const PAD = 30;

  function toPath(series: number[]): string {
    if (series.length === 0) return '';
    return series.map((v, i) => {
      const x = PAD + (i / Math.max(series.length - 1, 1)) * (W - PAD * 2);
      const y = H - PAD - (v / max) * (H - PAD * 2);
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  }

  // Y-axis labels
  const yLabels = [0, Math.round(max / 2), max];

  return (
    <div className="border rounded-lg p-4 bg-muted/30">
      {/* Legend */}
      <div className="flex items-center justify-end gap-4 mb-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-emerald-400 rounded" /> Completed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 bg-red-400 rounded" /> Failed
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[180px]" aria-label="Job throughput chart">
        {/* Grid lines */}
        {yLabels.map((v) => {
          const y = H - PAD - (v / max) * (H - PAD * 2);
          return (
            <g key={v}>
              <line x1={PAD} y1={y} x2={W - PAD} y2={y} className="stroke-border" strokeWidth="0.5" />
              <text x={PAD - 6} y={y + 3} className="fill-muted-foreground text-[9px]" textAnchor="end">
                {v.toLocaleString()}
              </text>
            </g>
          );
        })}

        {/* Completed line */}
        <path d={toPath(completedSeries)} fill="none" className="stroke-emerald-400" strokeWidth="1.5" strokeLinejoin="round" />
        {/* Failed line */}
        <path d={toPath(failedSeries)} fill="none" className="stroke-red-400" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function PageSkeleton() {
  return (
    <div className="flex h-full flex-col gap-0 bg-background">
      <div className="border-b bg-muted/50 px-6 py-4">
        <div className="grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 rounded-lg bg-primary" />
          ))}
        </div>
      </div>
      <div className="flex-1 px-6 py-6 space-y-6">
        <div className="grid grid-cols-7 gap-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[200px] w-full rounded-lg" />
        <Skeleton className="h-[200px] w-full rounded-lg" />
      </div>
    </div>
  );
}

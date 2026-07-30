import { useState, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Skeleton } from '~/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '~/components/ui/table';
import {
  useQueueJobs,
  useQueueActions,
  useJobDetail,
  useQueueSSE,
  useQueues,
  type JobInfo,
  type JobStatus,
  type SSEEvent,
} from '~/hooks/use-queues';
import type { Route } from './+types/queues.$name';

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `SureWaka Admin - ${params.name} Queue` }];
}

const STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
  { value: 'failed', label: 'Failed' },
  { value: 'active', label: 'Active' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'completed', label: 'Completed' },
  { value: 'delayed', label: 'Delayed' },
];

export default function QueueDetail() {
  const { name } = useParams<{ name: string }>();
  const [status, setStatus] = useState<JobStatus>('failed');
  const [page, setPage] = useState(1);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { queues } = useQueues();
  const { jobs, meta, isLoading, error, refetch } = useQueueJobs(name!, status, page);
  const { retryJob, removeJob, isActing } = useQueueActions();
  const { job: jobDetail, isLoading: jobLoading } = useJobDetail(name!, selectedJobId);

  // Find this queue's info
  const queueInfo = queues.find((q) => q.name === name);

  // Real-time
  const handleSSEEvent = useCallback((event: SSEEvent) => {
    if (event.queue === name) refetch();
  }, [name, refetch]);
  useQueueSSE(handleSSEEvent);

  const handleStatusChange = (newStatus: JobStatus) => {
    setStatus(newStatus);
    setPage(1);
    setSelectedJobId(null);
  };

  const handleRetry = async (jobId: string) => {
    const ok = await retryJob(name!, jobId);
    if (ok) { refetch(); setSelectedJobId(null); }
  };

  const handleRemove = async (jobId: string) => {
    const ok = await removeJob(name!, jobId);
    if (ok) { refetch(); setSelectedJobId(null); }
  };

  return (
    <div className="flex h-full">
      {/* ─── Left Panel: Queue + Job List ──────────────────────────────── */}
      <div className={`flex-1 flex flex-col min-w-0 ${selectedJobId ? 'border-r' : ''}`}>
        {/* Header */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
            <Link to="/queues" className="hover:text-foreground transition-colors">Overview</Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground capitalize">{name} Queue</span>
          </div>

          <h1 className="text-xl font-bold capitalize">{name} Queue</h1>

          {/* Worker dots + status counts (Kuue style) */}
          {queueInfo && (
            <div className="flex items-center gap-4 mt-3">
              {/* Worker dots */}
              <div className="flex items-center gap-0.5">
                {Array.from({ length: Math.min(queueInfo.workers.count, 12) }).map((_, i) => (
                  <span key={i} className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                ))}
                {queueInfo.workers.count === 0 && (
                  <span className="text-xs text-muted-foreground">No workers</span>
                )}
              </div>

              {/* Status counts inline */}
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">
                  Waiting <span className="font-medium text-foreground">{queueInfo.counts.waiting}</span>
                </span>
                <span className="text-muted-foreground">
                  Active <span className="font-medium text-foreground">{queueInfo.counts.active}</span>
                </span>
                <span className="text-muted-foreground">
                  Completed <span className="font-medium text-foreground">{queueInfo.counts.completed}</span>
                </span>
                <span className="text-muted-foreground">
                  Failed <span className="font-medium text-red-500">{queueInfo.counts.failed}</span>
                </span>
                <span className="text-muted-foreground">
                  Delayed <span className="font-medium text-foreground">{queueInfo.counts.delayed}</span>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Status tabs (Kuue style — filter row) */}
        <div className="px-6 flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-1">
            {STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleStatusChange(opt.value)}
                className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                  status === opt.value
                    ? 'bg-primary text-white font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {meta && <span>Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, meta.total)} of {meta.total} jobs</span>}
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refetch}>
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Job list table */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <XCircle className="h-6 w-6 text-destructive" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button variant="outline" size="sm" onClick={refetch}>Retry</Button>
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16">
              <p className="text-sm text-muted-foreground">No {status} jobs</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-xs w-24">ID</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Failed Reason</TableHead>
                  <TableHead className="text-xs">Timestamp</TableHead>
                  <TableHead className="text-xs w-20">Attempts</TableHead>
                  <TableHead className="text-xs w-8" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((job) => (
                  <TableRow
                    key={job.id}
                    className={`cursor-pointer transition-colors ${selectedJobId === job.id ? 'bg-muted' : ''}`}
                    onClick={() => setSelectedJobId(job.id)}
                  >
                    <TableCell className="font-mono text-xs">{job.id}</TableCell>
                    <TableCell>
                      <StatusDot status={status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                      {job.failedReason ?? '—'}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatTimestamp(job.timestamp)}
                    </TableCell>
                    <TableCell className="text-xs">{job.attemptsMade}</TableCell>
                    <TableCell>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination */}
          {meta && meta.totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 py-4 border-t">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                Previous
              </Button>
              <span className="text-xs text-muted-foreground">Page {page} of {meta.totalPages}</span>
              <Button variant="outline" size="sm" disabled={page >= meta.totalPages} onClick={() => setPage(p => p + 1)}>
                Next
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* ─── Right Panel: Job Detail (Kuue-style sidebar) ─────────────── */}
      {selectedJobId && (
        <div className="w-[380px] flex-shrink-0 overflow-y-auto border-l bg-background">
          {jobLoading || !jobDetail ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
            </div>
          ) : (
            <div className="flex flex-col h-full">
              {/* Detail metadata */}
              <div className="p-6 space-y-3 border-b">
                <DetailRow label="Job ID" value={jobDetail.id} mono />
                <DetailRow label="Status" value={jobDetail.state} badge />
                <DetailRow label="Created At" value={formatTimestamp(jobDetail.timestamp)} />
                {jobDetail.processedOn && (
                  <DetailRow label="Started At" value={formatTimestamp(jobDetail.processedOn)} />
                )}
                {jobDetail.finishedOn && (
                  <DetailRow label="Finished At" value={formatTimestamp(jobDetail.finishedOn)} />
                )}
                {jobDetail.processedOn && jobDetail.finishedOn && (
                  <DetailRow label="Duration" value={formatDuration(jobDetail.finishedOn - jobDetail.processedOn)} />
                )}
                <DetailRow label="Attempts" value={String(jobDetail.attemptsMade)} />
              </div>

              {/* Collapsible sections */}
              <div className="flex-1 overflow-y-auto">
                {/* Return value */}
                <CollapsibleSection title="Return value">
                  {jobDetail.returnvalue ? (
                    <CodeBlock content={typeof jobDetail.returnvalue === 'string' ? jobDetail.returnvalue : JSON.stringify(jobDetail.returnvalue, null, 2)} />
                  ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                  )}
                </CollapsibleSection>

                {/* Stacktrace */}
                <CollapsibleSection title="Stacktrace">
                  {jobDetail.stacktrace.length > 0 ? (
                    <pre className="text-xs text-destructive whitespace-pre-wrap font-mono">
                      {jobDetail.stacktrace.join('\n')}
                    </pre>
                  ) : (
                    <p className="text-xs text-muted-foreground">—</p>
                  )}
                </CollapsibleSection>

                {/* Options */}
                <CollapsibleSection title="Options">
                  <CodeBlock content={JSON.stringify(jobDetail.opts, null, 2)} />
                </CollapsibleSection>

                {/* Payload */}
                <CollapsibleSection title="Payload">
                  <CodeBlock content={JSON.stringify(jobDetail.data, null, 2)} />
                </CollapsibleSection>
              </div>

              {/* Bottom actions (Kuue-style) */}
              <div className="border-t px-6 py-4 flex items-center justify-end gap-2">
                {jobDetail.state === 'failed' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isActing}
                    onClick={() => handleRetry(jobDetail.id)}
                    className="gap-1.5"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Retry
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={isActing}
                  onClick={() => handleRemove(jobDetail.id)}
                  className="gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    completed: 'bg-green-500',
    failed: 'bg-red-500',
    active: 'bg-blue-500',
    waiting: 'bg-amber-500',
    delayed: 'bg-purple-500',
  };
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${colors[status] ?? 'bg-muted-foreground'}`} />
      <span className="capitalize">{status}</span>
    </span>
  );
}

function DetailRow({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      {badge ? (
        <Badge variant="outline" className="text-xs capitalize">{value}</Badge>
      ) : (
        <span className={`text-right ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
      )}
    </div>
  );
}

function CollapsibleSection({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="border-b">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full px-6 py-3 text-sm font-medium hover:bg-muted/50 transition-colors"
      >
        {title}
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && <div className="px-6 pb-4">{children}</div>}
    </div>
  );
}

function CodeBlock({ content }: { content: string }) {
  return (
    <pre className="rounded-md bg-card p-3 text-xs text-foreground overflow-x-auto whitespace-pre-wrap font-mono max-h-[200px] overflow-y-auto">
      {content}
    </pre>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} seconds`;
  const minutes = seconds / 60;
  return `${minutes.toFixed(1)} minutes`;
}

import { useState, useCallback } from 'react';
import { Link, useParams } from 'react-router';
import {
  Check,
  ChevronRight,
  Copy,
  RefreshCw,
  RotateCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { cn } from '~/lib/utils';
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

const STATUS_DOT: Record<string, string> = {
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  active: 'bg-blue-500',
  waiting: 'bg-amber-500',
  delayed: 'bg-purple-500',
};

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
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Link to="/queues" className="transition-colors hover:text-foreground">Queues</Link>
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
          <span className="capitalize text-foreground">{name}</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight capitalize">{name} Queue</h1>

        {queueInfo && (
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-0.5" aria-label={`${queueInfo.workers.count} workers online`}>
              {queueInfo.workers.count === 0 ? (
                <span className="text-xs text-muted-foreground">No workers</span>
              ) : (
                Array.from({ length: Math.min(queueInfo.workers.count, 12) }).map((_, i) => (
                  <span key={i} className="inline-block h-2 w-2 rounded-full bg-green-500" />
                ))
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-muted-foreground">
                Waiting <span className="font-medium tabular-nums text-foreground">{queueInfo.counts.waiting}</span>
              </span>
              <span className="text-muted-foreground">
                Active <span className="font-medium tabular-nums text-foreground">{queueInfo.counts.active}</span>
              </span>
              <span className="text-muted-foreground">
                Completed <span className="font-medium tabular-nums text-foreground">{queueInfo.counts.completed}</span>
              </span>
              <span className="text-muted-foreground">
                Failed <span className="font-medium tabular-nums text-red-600 dark:text-red-400">{queueInfo.counts.failed}</span>
              </span>
              <span className="text-muted-foreground">
                Delayed <span className="font-medium tabular-nums text-foreground">{queueInfo.counts.delayed}</span>
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-6">
        {/* ─── Left: Job List ─────────────────────────────────────────── */}
        <section className={cn('min-w-0 flex-1 rounded-xl border bg-card', selectedJobId && 'hidden lg:block')}>
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-b p-4"
            role="tablist"
            aria-label="Filter jobs by status"
          >
            <div className="flex items-center gap-1">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  role="tab"
                  aria-selected={status === opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn(
                    'cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                    status === opt.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              {meta && <span>Showing {((page - 1) * 20) + 1}–{Math.min(page * 20, meta.total)} of {meta.total} jobs</span>}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={refetch} aria-label="Refresh jobs">
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-3 py-16">
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
                  <TableRow>
                    <TableHead className="w-24">ID</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Failed Reason</TableHead>
                    <TableHead>Timestamp</TableHead>
                    <TableHead className="w-20">Attempts</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobs.map((job) => (
                    <JobRow
                      key={job.id}
                      job={job}
                      status={status}
                      selected={selectedJobId === job.id}
                      onSelect={() => setSelectedJobId(job.id)}
                    />
                  ))}
                </TableBody>
              </Table>
            )}

            {meta && meta.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 border-t py-4">
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
        </section>

        {/* ─── Right: Job Detail ──────────────────────────────────────── */}
        {selectedJobId && (
          <section className="w-full flex-shrink-0 rounded-xl border bg-card lg:w-[380px]">
            <div className="flex items-center justify-between border-b p-4 lg:hidden">
              <span className="text-sm font-medium">Job detail</span>
              <Button variant="ghost" size="sm" onClick={() => setSelectedJobId(null)}>Back to list</Button>
            </div>
            {jobLoading || !jobDetail ? (
              <div className="space-y-4 p-5">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            ) : (
              <div className="flex flex-col">
                <div className="space-y-3 border-b p-5">
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

                <div>
                  <CollapsibleSection title="Return value" copyText={jobDetail.returnvalue != null ? (typeof jobDetail.returnvalue === 'string' ? jobDetail.returnvalue : JSON.stringify(jobDetail.returnvalue, null, 2)) : undefined}>
                    {jobDetail.returnvalue ? (
                      <CodeBlock content={typeof jobDetail.returnvalue === 'string' ? jobDetail.returnvalue : JSON.stringify(jobDetail.returnvalue, null, 2)} />
                    ) : (
                      <p className="text-xs text-muted-foreground">—</p>
                    )}
                  </CollapsibleSection>

                  <CollapsibleSection title="Stacktrace" copyText={jobDetail.stacktrace.length > 0 ? jobDetail.stacktrace.join('\n') : undefined}>
                    {jobDetail.stacktrace.length > 0 ? (
                      <pre className="whitespace-pre-wrap font-mono text-xs text-destructive">
                        {jobDetail.stacktrace.join('\n')}
                      </pre>
                    ) : (
                      <p className="text-xs text-muted-foreground">—</p>
                    )}
                  </CollapsibleSection>

                  <CollapsibleSection title="Options" copyText={JSON.stringify(jobDetail.opts, null, 2)}>
                    <CodeBlock content={JSON.stringify(jobDetail.opts, null, 2)} />
                  </CollapsibleSection>

                  <CollapsibleSection title="Payload" copyText={JSON.stringify(jobDetail.data, null, 2)}>
                    <CodeBlock content={JSON.stringify(jobDetail.data, null, 2)} />
                  </CollapsibleSection>
                </div>

                <div className="flex items-center justify-end gap-2 border-t p-4">
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
          </section>
        )}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function JobRow({ job, status, selected, onSelect }: { job: JobInfo; status: JobStatus; selected: boolean; onSelect: () => void }) {
  return (
    <TableRow
      className={cn(
        'cursor-pointer focus-visible:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'bg-muted',
      )}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      tabIndex={0}
      role="row"
      aria-label={`Job ${job.id}`}
    >
      <TableCell className="font-mono text-xs">{job.id}</TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-1.5 text-xs">
          <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[status] ?? 'bg-muted-foreground')} aria-hidden="true" />
          <span className="capitalize">{status}</span>
        </span>
      </TableCell>
      <TableCell className="max-w-[200px] truncate text-xs text-muted-foreground" title={job.failedReason ?? undefined}>
        {job.failedReason ?? '—'}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {formatTimestamp(job.timestamp)}
      </TableCell>
      <TableCell className="text-xs tabular-nums">{job.attemptsMade}</TableCell>
      <TableCell>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      </TableCell>
    </TableRow>
  );
}

function DetailRow({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      {badge ? (
        <Badge variant="outline" className="text-xs capitalize">{value}</Badge>
      ) : (
        <span className={cn('text-right tabular-nums', mono && 'font-mono text-xs')}>{value}</span>
      )}
    </div>
  );
}

function CollapsibleSection({ title, children, copyText }: { title: string; children: React.ReactNode; copyText?: string }) {
  const [open, setOpen] = useState(true);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!copyText) return;
    await navigator.clipboard.writeText(copyText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="border-b">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-5 py-3 text-sm font-medium transition-colors hover:bg-muted/50"
        aria-expanded={open}
      >
        {title}
        {copyText && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleCopy}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCopy(e as unknown as React.MouseEvent);
              }
            }}
            aria-label={`Copy ${title.toLowerCase()} to clipboard`}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          </span>
        )}
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

function CodeBlock({ content }: { content: string }) {
  return (
    <pre className="max-h-[200px] overflow-x-auto overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-mono text-xs text-foreground">
      {content}
    </pre>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('en-NG', {
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

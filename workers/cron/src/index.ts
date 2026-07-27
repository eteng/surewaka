import { Worker } from 'bullmq';
import { cronQueue, connection } from './queue';
import type { CronJobName } from './queue';
import { handleSyncInfraCosts } from './jobs/sync-infra-costs/index';
import { rescueStaleRouting } from './jobs/rescue-stale-routing';
import { rescueMissedMatching } from './jobs/rescue-missed-matching';

// Seed repeating jobs — idempotent (BullMQ deduplicates by jobId)
await cronQueue.add(
  'sync-infra-costs',
  {},
  {
    jobId: 'sync-infra-costs-daily',
    repeat: { pattern: '0 5 * * *' },  // 05:00 UTC daily
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
  },
);

await cronQueue.add(
  'rescue-stale-routing',
  {},
  {
    jobId: 'rescue-stale-routing-5min',
    repeat: { pattern: '*/5 * * * *' },  // Every 5 minutes
    attempts: 1,
  },
);

await cronQueue.add(
  'rescue-missed-matching',
  {},
  {
    jobId: 'rescue-missed-matching-5min',
    repeat: { pattern: '*/5 * * * *' },  // Every 5 minutes
    attempts: 1,
  },
);

const worker = new Worker<Record<string, never>, void, CronJobName>(
  'cron',
  async (job) => {
    switch (job.name) {
      case 'sync-infra-costs':
        return handleSyncInfraCosts();
      case 'rescue-stale-routing':
        return rescueStaleRouting();
      case 'rescue-missed-matching':
        return rescueMissedMatching();
      default:
        throw new Error(`Unknown cron job: ${String(job.name)}`);
    }
  },
  { connection, concurrency: 1 },
);

worker.on('completed', (job) => console.log(`✅ Cron job ${job.name} completed`));
worker.on('failed', (job, err) => console.error(`❌ Cron job ${job?.name} failed:`, err));

console.log('⏰ Cron worker started — sync-infra-costs scheduled at 05:00 UTC daily');

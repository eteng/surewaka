// Feature: push-notifications
// Job Processor — processes transactional and broadcast push notification jobs.
// Requirements: 2.2, 2.4, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.4, 4.5, 7.2, 7.3, 8.1, 8.2

import { UnrecoverableError } from 'bullmq';
import type { Job } from 'bullmq';
import type { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import type { PushJobData, BroadcastChunkJobData } from '@surewaka/shared';
import { expo } from './expo-client';
import {
  resolveTokens,
  resolveTokensBulk,
  deactivateToken,
  deactivateTokens,
} from './token-resolver';
import type { ResolvedToken, ResolvedTokenBulk } from './token-resolver';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Permanent Expo errors that should not be retried */
const PERMANENT_ERRORS = new Set([
  'DeviceNotRegistered',
  'InvalidCredentials',
  'MessageTooBig',
  'MessageRateExceeded',
]);

/** Errors that indicate the token should be deactivated */
const TOKEN_DEACTIVATION_ERRORS = new Set(['DeviceNotRegistered', 'InvalidCredentials']);

// ─── Transactional Job Processor ─────────────────────────────────────────────

/**
 * Process a single-user push notification job.
 *
 * Flow:
 * 1. Resolve tokens (preference check + app filter)
 * 2. Build ExpoPushMessages
 * 3. Chunk (max 100) and send via Expo API
 * 4. Process tickets — deactivate invalid tokens
 * 5. Log batch metrics
 *
 * Requirements: 2.2, 2.4, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.4, 4.5, 8.1, 8.2
 */
export async function processTransactionalJob(job: Job<PushJobData>): Promise<void> {
  const { userId, targetApp, payload, priority } = job.data;
  const startTime = Date.now();

  // 1. Resolve tokens (includes preference re-check at delivery time)
  const tokens = await resolveTokens(userId, targetApp);

  if (tokens.length === 0) {
    // Req 3.7 — no active tokens, complete without sending
    console.log(`📭 Job ${job.id}: No active tokens for user ${userId}, skipping`);
    return;
  }

  // 2. Build Expo messages
  const messages = buildMessages(tokens, payload, priority);

  // 3. Chunk and send
  const { successCount, failureCount, tokensToDeactivate } = await sendChunked(messages, tokens);

  // 4. Deactivate invalid tokens (Req 2.2)
  for (const tokenId of tokensToDeactivate) {
    await deactivateToken(tokenId);
  }

  // 5. Log batch metrics (Req 8.2)
  const durationMs = Date.now() - startTime;
  console.log(
    `📊 Job ${job.id}: sent=${successCount}, failed=${failureCount}, ` +
      `tokens=${tokens.length}, deactivated=${tokensToDeactivate.length}, ` +
      `duration=${durationMs}ms`,
  );
}

// ─── Broadcast Chunk Job Processor ───────────────────────────────────────────

/**
 * Process a broadcast chunk job (batch of users).
 *
 * Flow:
 * 1. Resolve tokens in bulk (segment-aware app filter + preference check)
 * 2. Build ExpoPushMessages for all returned tokens
 * 3. Chunk (max 100) and send via Expo API
 * 4. Bulk-deactivate invalid tokens
 * 5. Log batch metrics
 *
 * Requirements: 2.2, 4.4, 4.5, 7.2, 7.3, 8.2, 10.4
 */
export async function processBroadcastChunkJob(job: Job<BroadcastChunkJobData>): Promise<void> {
  const { userIds, payload, segment } = job.data;
  const startTime = Date.now();

  // 1. Resolve tokens in bulk (segment drives app filter)
  const tokens = await resolveTokensBulk(userIds, segment);

  if (tokens.length === 0) {
    console.log(
      `📭 Broadcast job ${job.id}: No active tokens for ${userIds.length} users (segment: ${segment}), skipping`,
    );
    return;
  }

  // 2. Build Expo messages
  const messages = buildMessages(tokens, payload, 'normal');

  // 3. Chunk and send
  const { successCount, failureCount, tokensToDeactivate } = await sendChunked(messages, tokens);

  // 4. Bulk-deactivate invalid tokens (Req 2.2)
  await deactivateTokens(tokensToDeactivate);

  // 5. Log batch metrics (Req 8.2)
  const durationMs = Date.now() - startTime;
  console.log(
    `📊 Broadcast job ${job.id}: sent=${successCount}, failed=${failureCount}, ` +
      `tokens=${tokens.length}, users=${userIds.length}, segment=${segment}, ` +
      `deactivated=${tokensToDeactivate.length}, duration=${durationMs}ms`,
  );
}

// ─── Shared Helpers ──────────────────────────────────────────────────────────

/**
 * Build ExpoPushMessage array from resolved tokens and payload.
 */
function buildMessages(
  tokens: (ResolvedToken | ResolvedTokenBulk)[],
  payload: PushJobData['payload'],
  priority: 'high' | 'normal',
): ExpoPushMessage[] {
  return tokens.map((token) => ({
    to: token.expoPushToken,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    sound: 'default' as const,
    priority: priority === 'high' ? 'high' : 'normal',
  }));
}

/**
 * Chunk messages (max 100) and send via Expo API.
 * Processes tickets to identify tokens that need deactivation.
 * Throws on permanent errors; lets transient errors bubble for BullMQ retry.
 */
async function sendChunked(
  messages: ExpoPushMessage[],
  tokens: (ResolvedToken | ResolvedTokenBulk)[],
): Promise<{ successCount: number; failureCount: number; tokensToDeactivate: string[] }> {
  const chunks = expo.chunkPushNotifications(messages);
  let successCount = 0;
  let failureCount = 0;
  const tokensToDeactivate: string[] = [];

  for (const chunk of chunks) {
    let tickets: ExpoPushTicket[];

    try {
      tickets = await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      // Expo SDK throws for network/server errors — transient, let BullMQ retry
      throw new Error(
        `Expo API request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Process tickets
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i]!;

      if (ticket.status === 'ok') {
        successCount++;
        continue;
      }

      // ticket.status === 'error'
      failureCount++;
      const errorType = ticket.details?.error;

      if (errorType && TOKEN_DEACTIVATION_ERRORS.has(errorType)) {
        // Find the corresponding token by matching position within this chunk
        const chunkStartIndex = chunks.indexOf(chunk) * 100; // Approximate
        // More reliable: find the token by matching the expo push token
        const failedMessage = chunk[i];
        if (failedMessage) {
          const failedToken = tokens.find((t) => t.expoPushToken === failedMessage.to);
          if (failedToken) {
            tokensToDeactivate.push(failedToken.id);
          }
        }
      }

      if (errorType && PERMANENT_ERRORS.has(errorType)) {
        // For MessageTooBig — throw UnrecoverableError (no retry)
        if (errorType === 'MessageTooBig') {
          throw new UnrecoverableError(
            `Permanent Expo error: ${errorType} — ${ticket.message ?? 'no message'}`,
          );
        }
        // DeviceNotRegistered and InvalidCredentials: token is deactivated above,
        // but the job itself can still continue for other tokens in the batch
      }
    }
  }

  return { successCount, failureCount, tokensToDeactivate };
}

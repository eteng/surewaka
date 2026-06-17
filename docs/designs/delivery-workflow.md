# Delivery Lifecycle Workflow

## Overview

The delivery lifecycle is modeled as a durable workflow using Vercel Workflows (WDK). The workflow is triggered by the Fly.io API when a booking is confirmed, and it orchestrates the entire delivery from driver matching through to payment release.

## Architecture

```
┌──────────────┐         ┌──────────────────────────┐
│  Fly.io API  │         │  Vercel Workflows         │
│              │         │                           │
│ POST /booking│         │  deliveryLifecycle()      │
│  /confirm    │────────>│    waitForDriverAccept    │
│              │  trigger │    waitForPickup          │
│              │         │    waitForDelivery         │
│ POST /delivery         │    releaseEscrow          │
│  /status     │<────────│                           │
│  (webhooks   │  events │                           │
│   from driver│────────>│                           │
│   app)       │         │                           │
└──────────────┘         └──────────────────────────┘
```

**How events flow:**
1. Fly.io API triggers the workflow on booking confirmation
2. Driver app sends status updates to Fly.io API
3. Fly.io API sends events to the running workflow via `workflow.sendEvent()`
4. Workflow advances to next step on each event
5. Workflow calls back to Fly.io API for DB operations (escrow release, notifications)

## Workflow Definition

```typescript
import { workflow } from '@vercel/workflow';

interface DeliveryInput {
  deliveryId: string;
  senderId: string;
  escrowId: string;
  amount: number; // kobo
  pickupAddress: string;
  dropoffAddress: string;
}

export const deliveryLifecycle = workflow('delivery-lifecycle', async (ctx) => {
  const { deliveryId, senderId, escrowId, amount } = ctx.input as DeliveryInput;

  // ─── STEP 1: Match Driver ───────────────────────────────
  const matchResult = await ctx.run('match-driver', async () => {
    // Call Fly.io API to broadcast to nearby drivers
    const res = await fetch(`${API_URL}/api/v1/internal/deliveries/${deliveryId}/broadcast`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
    });
    return res.json();
  });

  // ─── STEP 2: Wait for Driver Accept (max 10 min) ───────
  const acceptEvent = await ctx.waitForEvent('driver-accepted', {
    timeout: '10m',
  });

  if (!acceptEvent) {
    // No driver accepted — auto-cancel and refund
    await ctx.run('auto-cancel', async () => {
      await fetch(`${API_URL}/api/v1/internal/deliveries/${deliveryId}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
        body: JSON.stringify({ reason: 'no_driver_available', refundFull: true }),
      });
    });
    return { status: 'cancelled', reason: 'no_driver_available' };
  }

  const driverId = acceptEvent.data.driverId;

  // ─── STEP 3: Wait for Pickup (max 45 min) ──────────────
  await ctx.run('notify-sender-driver-assigned', async () => {
    await fetch(`${API_URL}/api/v1/internal/notifications/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
      body: JSON.stringify({
        userId: senderId,
        title: 'Driver assigned!',
        body: 'Your driver is on the way to pick up your package.',
      }),
    });
  });

  const pickupEvent = await ctx.waitForEvent('package-picked-up', {
    timeout: '45m',
  });

  if (!pickupEvent) {
    // Driver didn't pick up in time — reassign or cancel
    await ctx.run('pickup-timeout', async () => {
      await fetch(`${API_URL}/api/v1/internal/deliveries/${deliveryId}/reassign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
        body: JSON.stringify({ reason: 'pickup_timeout', previousDriverId: driverId }),
      });
    });
    return { status: 'reassigning', reason: 'pickup_timeout' };
  }

  // ─── STEP 4: In Transit — Wait for Delivery (max 4 hours) ─
  await ctx.run('notify-sender-picked-up', async () => {
    await fetch(`${API_URL}/api/v1/internal/notifications/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
      body: JSON.stringify({
        userId: senderId,
        title: 'Package picked up!',
        body: 'Your package is on its way to the recipient.',
      }),
    });
  });

  const deliveryEvent = await ctx.waitForEvent('delivery-confirmed', {
    timeout: '4h',
  });

  if (!deliveryEvent) {
    // Delivery didn't complete in time — escalate to ops
    await ctx.run('delivery-timeout-escalate', async () => {
      await fetch(`${API_URL}/api/v1/internal/deliveries/${deliveryId}/escalate`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
        body: JSON.stringify({ reason: 'delivery_timeout' }),
      });
    });
    return { status: 'escalated', reason: 'delivery_timeout' };
  }

  // ─── STEP 5: Release Escrow ─────────────────────────────
  const payout = await ctx.run('release-escrow', async () => {
    const res = await fetch(`${API_URL}/api/v1/internal/escrow/${escrowId}/release`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
      body: JSON.stringify({ driverId }),
    });
    return res.json();
  });

  // ─── STEP 6: Notify Both Parties ───────────────────────
  await ctx.run('notify-completion', async () => {
    await Promise.all([
      fetch(`${API_URL}/api/v1/internal/notifications/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
        body: JSON.stringify({
          userId: senderId,
          title: 'Delivered!',
          body: 'Your package has been delivered successfully.',
        }),
      }),
      fetch(`${API_URL}/api/v1/internal/notifications/send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
        body: JSON.stringify({
          userId: driverId,
          title: 'Earning credited!',
          body: `₦${(payout.driverAmount / 100).toLocaleString()} added to your wallet.`,
        }),
      }),
    ]);
  });

  return { status: 'completed', deliveryId, driverId, payout };
});
```

## Fly.io API Integration

### Triggering the Workflow (on booking confirmation)

```typescript
// apps/api/src/routes/booking.ts
import { workflows } from '@vercel/workflow/client';

app.post('/api/v1/booking/confirm', requireAuth, async (c) => {
  const { deliveryId } = await c.req.json();
  const userId = c.get('userId');

  // 1. Debit wallet + create escrow (atomic DB transaction)
  const escrow = await confirmBookingAndHoldEscrow(deliveryId, userId);

  // 2. Trigger the delivery lifecycle workflow
  await workflows.trigger('delivery-lifecycle', {
    deliveryId,
    senderId: userId,
    escrowId: escrow.id,
    amount: escrow.totalAmount,
    pickupAddress: escrow.delivery.pickupAddress,
    dropoffAddress: escrow.delivery.dropoffAddress,
  });

  return c.json({ data: { deliveryId, status: 'pending' } });
});
```

### Sending Events to the Workflow (from driver status updates)

```typescript
// apps/api/src/routes/delivery-status.ts
import { workflows } from '@vercel/workflow/client';

app.post('/api/v1/delivery/:id/status', requireAuth, async (c) => {
  const { id } = c.req.param();
  const { status } = await c.req.json();
  const driverId = c.get('userId');

  // Update delivery status in DB
  await updateDeliveryStatus(id, status);

  // Send event to running workflow
  const eventMap: Record<string, string> = {
    'accepted': 'driver-accepted',
    'picked_up': 'package-picked-up',
    'delivered': 'delivery-confirmed',
  };

  const eventName = eventMap[status];
  if (eventName) {
    await workflows.sendEvent(`delivery-${id}`, eventName, {
      driverId,
      timestamp: new Date().toISOString(),
    });
  }

  return c.json({ data: { status: 'updated' } });
});
```

## Internal API Routes (called by Workflow)

These are only accessible with `INTERNAL_API_KEY` (not exposed to clients):

| Route | Purpose |
|-------|---------|
| `POST /api/v1/internal/deliveries/:id/broadcast` | Notify nearby drivers of new job |
| `POST /api/v1/internal/deliveries/:id/cancel` | Cancel + refund |
| `POST /api/v1/internal/deliveries/:id/reassign` | Find new driver |
| `POST /api/v1/internal/deliveries/:id/escalate` | Alert ops team |
| `POST /api/v1/internal/escrow/:id/release` | Release funds to driver wallet |
| `POST /api/v1/internal/notifications/send` | Send push notification |

## Timeout Behavior

| Step | Timeout | On timeout |
|------|---------|-----------|
| Driver accept | 10 min | Auto-cancel, full refund to sender |
| Pickup | 45 min | Reassign to new driver, penalize original |
| Delivery | 4 hours | Escalate to ops team, hold escrow |

## Cancellation Mid-Workflow

If the sender cancels while the workflow is running:

```typescript
// API receives cancel request → sends cancel event to workflow
await workflows.sendEvent(`delivery-${id}`, 'sender-cancelled', { reason });
```

The workflow can listen for cancellation at any wait point:

```typescript
const event = await ctx.waitForEvent(['package-picked-up', 'sender-cancelled'], {
  timeout: '45m',
});

if (event?.name === 'sender-cancelled') {
  await ctx.run('process-cancellation', async () => {
    await fetch(`${API_URL}/api/v1/internal/escrow/${escrowId}/refund`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${INTERNAL_API_KEY}` },
      body: JSON.stringify({ reason: event.data.reason, stage: 'pre_pickup' }),
    });
  });
  return { status: 'cancelled', reason: event.data.reason };
}
```

## Deployment

The workflow lives in a Vercel project (can be the same as your web apps or a separate `workers/delivery-workflow` project):

```
workers/
└── delivery-workflow/
    ├── package.json
    ├── src/
    │   └── delivery-lifecycle.ts
    ├── vercel.json
    └── tsconfig.json
```

Deploy: `vercel deploy` (or auto-deploy on push to `main`).

## Why This Architecture

| Concern | Solution |
|---------|----------|
| Wallet operations (atomic, fast) | Stay on Fly.io API with direct Postgres |
| Long-lived orchestration (hours/days) | Vercel Workflows with `waitForEvent` |
| Driver status updates | Fly.io API receives → forwards event to workflow |
| Timeout handling | Built into workflow with automatic cleanup |
| Failure recovery | Workflow resumes from last completed step |
| Cross-platform coupling | Minimal — one HTTP trigger, events via SDK |

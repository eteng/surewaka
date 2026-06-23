// Feature: carrier-vetting-pipeline
// Carrier Vetting Service — business logic for carrier application lifecycle,
// approval, rejection, and strategic (direct) carrier creation.

import { db } from '@surewaka/db';
import {
  carrierApplications,
  carrierApplicationEvents,
  carrierMemberInvitations,
  carriers,
} from '@surewaka/db';
import { eq, and, or, ilike, count, desc } from 'drizzle-orm';
import { getClerkClient } from '@surewaka/auth';

// ─── Constants ───────────────────────────────────────────────────────────────

const INVITATION_TTL_DAYS = 7;
const CARRIER_APP_URL = process.env['CARRIER_APP_URL'] ?? 'https://fleet.surewaka.com';

// ─── Types ───────────────────────────────────────────────────────────────────

type ServiceResult<T> = {
  data: T | null;
  error: { code: string; message: string } | null;
};

export type SubmitCarrierApplicationInput = {
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  cacNumber?: string;
  fleetSize?: number;
  serviceAreas: string[];
  notes?: string;
};

export type ApproveCarrierApplicationInput = {
  driverVettingEnabled?: boolean;
  adminEmail?: string;
};

export type CreateStrategicCarrierInput = {
  name: string;
  contactEmail: string;
  slug: string;
  driverVettingEnabled?: boolean;
  logoUrl?: string;
  adminEmail?: string;
};

export type CarrierApplicationListQuery = {
  status?: 'pending' | 'under_review' | 'approved' | 'rejected';
  search?: string;
  page?: number;
  pageSize?: number;
};

export type CarrierListQuery = {
  search?: string;
  page?: number;
  pageSize?: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function invitationExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + INVITATION_TTL_DAYS);
  return d;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function sendClerkInvitation(email: string): Promise<void> {
  const clerk = getClerkClient();
  await clerk.invitations.createInvitation({
    emailAddress: email,
    redirectUrl: CARRIER_APP_URL,
    ignoreExisting: true,
  });
}

// ─── Submit Application ───────────────────────────────────────────────────────

/**
 * Submit a new carrier application.
 * Returns CONFLICT if the email already has an active (pending/under_review) application.
 */
export async function submitApplication(
  input: SubmitCarrierApplicationInput,
): Promise<ServiceResult<{ id: string }>> {
  // Duplicate check: same email with pending or under_review status
  const existing = await db
    .select()
    .from(carrierApplications)
    .where(
      and(
        eq(carrierApplications.email, input.email),
        or(
          eq(carrierApplications.status, 'pending'),
          eq(carrierApplications.status, 'under_review'),
        ),
      ),
    );

  if (existing.length > 0) {
    return {
      data: null,
      error: {
        code: 'CONFLICT',
        message: 'An active application already exists for this email address.',
      },
    };
  }

  // Insert application + initial event in a transaction
  const result = await db.transaction(async (tx) => {
    const [app] = await tx
      .insert(carrierApplications)
      .values({
        businessName: input.businessName,
        contactName: input.contactName,
        email: input.email,
        phone: input.phone,
        cacNumber: input.cacNumber,
        fleetSize: input.fleetSize,
        serviceAreas: input.serviceAreas,
        notes: input.notes,
        status: 'pending',
      })
      .returning({ id: carrierApplications.id });

    await tx.insert(carrierApplicationEvents).values({
      applicationId: app!.id,
      fromStatus: null,
      toStatus: 'pending',
      performedBy: null,
      notes: 'Application submitted',
    });

    return app!;
  });

  return { data: { id: result.id }, error: null };
}

// ─── List Applications ────────────────────────────────────────────────────────

export async function listApplications(query: CarrierApplicationListQuery = {}): Promise<
  ServiceResult<{
    data: (typeof carrierApplications.$inferSelect)[];
    total: number;
  }>
> {
  const { status, search, page = 1, pageSize = 20 } = query;
  const offset = (page - 1) * pageSize;

  const conditions: ReturnType<typeof eq>[] = [];
  if (status) {
    conditions.push(eq(carrierApplications.status, status));
  }
  if (search) {
    conditions.push(
      or(
        ilike(carrierApplications.businessName, `%${search}%`),
        ilike(carrierApplications.contactName, `%${search}%`),
        ilike(carrierApplications.email, `%${search}%`),
      ) as ReturnType<typeof eq>,
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, [countRow]] = await Promise.all([
    db
      .select()
      .from(carrierApplications)
      .where(where)
      .orderBy(desc(carrierApplications.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: count() }).from(carrierApplications).where(where),
  ]);

  return {
    data: { data: rows, total: countRow?.total ?? 0 },
    error: null,
  };
}

// ─── Get Application ──────────────────────────────────────────────────────────

export async function getApplication(id: string): Promise<
  ServiceResult<
    (typeof carrierApplications.$inferSelect) & {
      events: (typeof carrierApplicationEvents.$inferSelect)[];
    }
  >
> {
  const [app] = await db
    .select()
    .from(carrierApplications)
    .where(eq(carrierApplications.id, id))
    .limit(1);

  if (!app) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Application not found.' },
    };
  }

  const events = await db
    .select()
    .from(carrierApplicationEvents)
    .where(eq(carrierApplicationEvents.applicationId, id))
    .orderBy(carrierApplicationEvents.createdAt);

  return { data: { ...app, events }, error: null };
}

// ─── Start Review ─────────────────────────────────────────────────────────────

export async function startReview(params: {
  applicationId: string;
  adminId: string;
  notes?: string;
}): Promise<ServiceResult<{ id: string }>> {
  const { applicationId, adminId, notes } = params;

  const [app] = await db
    .select()
    .from(carrierApplications)
    .where(eq(carrierApplications.id, applicationId))
    .limit(1);

  if (!app) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Application not found.' },
    };
  }

  if (app.status !== 'pending') {
    return {
      data: null,
      error: {
        code: 'INVALID_STATUS',
        message: `Cannot start review: application is currently '${app.status}', expected 'pending'.`,
      },
    };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(carrierApplications)
      .set({ status: 'under_review', reviewedBy: adminId, updatedAt: new Date() })
      .where(eq(carrierApplications.id, applicationId));

    await tx.insert(carrierApplicationEvents).values({
      applicationId,
      fromStatus: 'pending',
      toStatus: 'under_review',
      performedBy: adminId,
      notes: notes ?? null,
    });
  });

  return { data: { id: applicationId }, error: null };
}

// ─── Approve Application ──────────────────────────────────────────────────────

export async function approveApplication(params: {
  applicationId: string;
  adminId: string;
  input: ApproveCarrierApplicationInput;
}): Promise<ServiceResult<{ carrierId: string }>> {
  const { applicationId, adminId, input } = params;

  const [app] = await db
    .select()
    .from(carrierApplications)
    .where(eq(carrierApplications.id, applicationId))
    .limit(1);

  if (!app) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Application not found.' },
    };
  }

  if (app.status !== 'under_review') {
    return {
      data: null,
      error: {
        code: 'INVALID_STATUS',
        message: `Cannot approve: application is currently '${app.status}', expected 'under_review'.`,
      },
    };
  }

  const now = new Date();

  const carrierId = await db.transaction(async (tx) => {
    // Create carrier record
    const [carrier] = await tx
      .insert(carriers)
      .values({
        name: app.businessName,
        contactEmail: app.email,
        slug: slugify(app.businessName),
        driverVettingEnabled: input.driverVettingEnabled ?? false,
        applicationId,
        isVerified: true,
        isActive: true,
        verifiedBy: adminId,
        verifiedAt: now,
      })
      .returning({ id: carriers.id });

    // Create invitation record if email provided
    if (input.adminEmail) {
      await tx.insert(carrierMemberInvitations).values({
        carrierId: carrier!.id,
        email: input.adminEmail,
        role: 'carrier_admin',
        invitedBy: adminId,
        expiresAt: invitationExpiresAt(),
      });
    }

    // Update application status
    await tx
      .update(carrierApplications)
      .set({
        status: 'approved',
        reviewedBy: adminId,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(carrierApplications.id, applicationId));

    // Log event
    await tx.insert(carrierApplicationEvents).values({
      applicationId,
      fromStatus: 'under_review',
      toStatus: 'approved',
      performedBy: adminId,
    });

    return carrier!.id;
  });

  // Send Clerk invitation AFTER transaction — failure must not roll back the carrier
  if (input.adminEmail) {
    try {
      await sendClerkInvitation(input.adminEmail);
    } catch {
      // Log but don't throw — carrier is already created
      console.error(`[carrier-vetting] Clerk invitation failed for ${input.adminEmail}`);
    }
  }

  return { data: { carrierId }, error: null };
}

// ─── Reject Application ───────────────────────────────────────────────────────

export async function rejectApplication(params: {
  applicationId: string;
  adminId: string;
  reason: string;
}): Promise<ServiceResult<{ id: string }>> {
  const { applicationId, adminId, reason } = params;

  const [app] = await db
    .select()
    .from(carrierApplications)
    .where(eq(carrierApplications.id, applicationId))
    .limit(1);

  if (!app) {
    return {
      data: null,
      error: { code: 'NOT_FOUND', message: 'Application not found.' },
    };
  }

  if (app.status !== 'under_review') {
    return {
      data: null,
      error: {
        code: 'INVALID_STATUS',
        message: `Cannot reject: application is currently '${app.status}', expected 'under_review'.`,
      },
    };
  }

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(carrierApplications)
      .set({
        status: 'rejected',
        reviewedBy: adminId,
        reviewNotes: reason,
        reviewedAt: now,
        updatedAt: now,
      })
      .where(eq(carrierApplications.id, applicationId));

    await tx.insert(carrierApplicationEvents).values({
      applicationId,
      fromStatus: 'under_review',
      toStatus: 'rejected',
      performedBy: adminId,
      notes: reason,
    });
  });

  return { data: { id: applicationId }, error: null };
}

// ─── Create Strategic Carrier ─────────────────────────────────────────────────

/**
 * Directly create a verified carrier without an application (e.g. enterprise deals).
 * Sends a Clerk invitation if adminEmail is provided.
 */
export async function createStrategicCarrier(params: {
  adminId: string;
  input: CreateStrategicCarrierInput;
}): Promise<ServiceResult<{ carrierId: string }>> {
  const { adminId, input } = params;

  const carrierId = await db.transaction(async (tx) => {
    const [carrier] = await tx
      .insert(carriers)
      .values({
        name: input.name,
        contactEmail: input.contactEmail,
        slug: input.slug,
        driverVettingEnabled: input.driverVettingEnabled ?? false,
        logoUrl: input.logoUrl,
        applicationId: null,
        isVerified: true,
        isActive: true,
        verifiedBy: adminId,
        verifiedAt: new Date(),
      })
      .returning({ id: carriers.id });

    if (input.adminEmail) {
      await tx.insert(carrierMemberInvitations).values({
        carrierId: carrier!.id,
        email: input.adminEmail,
        role: 'carrier_admin',
        invitedBy: adminId,
        expiresAt: invitationExpiresAt(),
      });
    }

    return carrier!.id;
  });

  // Send Clerk invitation AFTER transaction
  if (input.adminEmail) {
    try {
      await sendClerkInvitation(input.adminEmail);
    } catch {
      console.error(`[carrier-vetting] Clerk invitation failed for ${input.adminEmail}`);
    }
  }

  return { data: { carrierId }, error: null };
}

// ─── List Carriers ────────────────────────────────────────────────────────────

export async function listCarriers(query: CarrierListQuery = {}): Promise<
  ServiceResult<{
    data: (typeof carriers.$inferSelect)[];
    total: number;
  }>
> {
  const { search, page = 1, pageSize = 20 } = query;
  const offset = (page - 1) * pageSize;

  const where = search
    ? and(
        eq(carriers.isActive, true),
        or(
          ilike(carriers.name, `%${search}%`),
          ilike(carriers.contactEmail, `%${search}%`),
        ) as ReturnType<typeof eq>,
      )
    : eq(carriers.isActive, true);

  const [rows, [countRow]] = await Promise.all([
    db
      .select()
      .from(carriers)
      .where(where)
      .orderBy(desc(carriers.createdAt))
      .limit(pageSize)
      .offset(offset),
    db.select({ total: count() }).from(carriers).where(where),
  ]);

  return {
    data: { data: rows, total: countRow?.total ?? 0 },
    error: null,
  };
}

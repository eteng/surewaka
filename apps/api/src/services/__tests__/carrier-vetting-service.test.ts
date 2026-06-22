import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// vi.mock is hoisted before any variable declarations, so all stubs must be
// defined *inside* the factory functions (same pattern as user-management-service tests).

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val, op: 'eq' }),
  and: (...conds: unknown[]) => ({ conds, op: 'and' }),
  or: (...conds: unknown[]) => ({ conds, op: 'or' }),
  ilike: (col: unknown, pattern: unknown) => ({ col, pattern, op: 'ilike' }),
  desc: (col: unknown) => ({ col, dir: 'desc' }),
  count: () => ({ fn: 'count' }),
}));

vi.mock('@surewaka/db', () => {
  const makeTable = (cols: string[]): Record<string, string> =>
    Object.fromEntries(cols.map((c) => [c, c]));

  return {
    db: {
      select: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      transaction: vi.fn(),
    },
    carrierApplications: makeTable([
      'id', 'businessName', 'contactName', 'email', 'phone', 'cacNumber',
      'fleetSize', 'serviceAreas', 'notes', 'status', 'reviewedBy',
      'reviewNotes', 'reviewedAt', 'createdAt', 'updatedAt',
    ]),
    carrierApplicationEvents: makeTable([
      'id', 'applicationId', 'fromStatus', 'toStatus', 'performedBy', 'notes', 'createdAt',
    ]),
    carrierMemberInvitations: makeTable([
      'id', 'carrierId', 'phone', 'email', 'role', 'invitedBy', 'expiresAt', 'acceptedAt', 'createdAt',
    ]),
    carriers: makeTable([
      'id', 'name', 'contactEmail', 'rating', 'deliveryCount', 'createdAt', 'slug',
      'logoUrl', 'isVerified', 'isActive', 'verifiedAt', 'verifiedBy', 'updatedAt',
      'driverVettingEnabled', 'applicationId',
    ]),
  };
});

vi.mock('@surewaka/auth', () => ({
  getClerkClient: vi.fn().mockReturnValue({
    invitations: {
      createInvitation: vi.fn(),
    },
  }),
}));

import {
  submitApplication,
  rejectApplication,
  startReview,
} from '../carrier-vetting-service';
import { db } from '@surewaka/db';

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── submitApplication ────────────────────────────────────────────────────────

describe('submitApplication', () => {
  it('returns CONFLICT when email already has a pending/under_review application', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([{ id: 'existing-id' }]),
      }),
    });
    vi.mocked(db.select).mockImplementation(mockSelect);

    const result = await submitApplication({
      businessName: 'Test Co',
      contactName: 'Test User',
      email: 'test@test.com',
      phone: '+2348012345678',
      serviceAreas: ['Lagos'],
    });

    expect(result.error?.code).toBe('CONFLICT');
    expect(result.data).toBeNull();
  });
});

// ─── startReview ──────────────────────────────────────────────────────────────

describe('startReview', () => {
  it('returns NOT_FOUND when application does not exist', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    });
    vi.mocked(db.select).mockImplementation(mockSelect);

    const result = await startReview({ applicationId: 'nonexistent', adminId: 'admin-1' });
    expect(result.error?.code).toBe('NOT_FOUND');
  });

  it('returns INVALID_STATUS when application is not pending', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'app-1', status: 'approved' }]),
        }),
      }),
    });
    vi.mocked(db.select).mockImplementation(mockSelect);

    const result = await startReview({ applicationId: 'app-1', adminId: 'admin-1' });
    expect(result.error?.code).toBe('INVALID_STATUS');
  });
});

// ─── rejectApplication ────────────────────────────────────────────────────────

describe('rejectApplication', () => {
  it('returns INVALID_STATUS when application is not under_review', async () => {
    const mockSelect = vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ id: 'app-1', status: 'pending' }]),
        }),
      }),
    });
    vi.mocked(db.select).mockImplementation(mockSelect);

    const result = await rejectApplication({
      applicationId: 'app-1',
      adminId: 'admin-1',
      reason: 'CAC number could not be verified.',
    });
    expect(result.error?.code).toBe('INVALID_STATUS');
  });
});

// Feature: surewaka-landing-page, Property 1: Waitlist signup data persistence round-trip
// Validates: Requirements 5.3, 5.6

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';

// Mock the supabase.server module before importing the action
vi.mock('~/lib/supabase.server', () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { action } from '../routes/home';
import { getSupabaseAdmin } from '~/lib/supabase.server';

describe('Waitlist Form Action — Property Tests', () => {
  /**
   * Helper: create a Request with form data matching a waitlist signup.
   */
  function createFormRequest(data: {
    fullName: string;
    email: string;
    userType: string;
    source: string;
  }): Request {
    const formData = new URLSearchParams();
    formData.set('fullName', data.fullName);
    formData.set('email', data.email);
    formData.set('userType', data.userType);
    formData.set('source', data.source);

    return new Request('http://localhost/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString(),
    });
  }

  /**
   * Helper: set up the Supabase mock and return a reference to capture insert data.
   */
  function setupSupabaseMock() {
    let capturedData: Record<string, unknown> | null = null;

    const mockInsert = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      capturedData = data;
      return Promise.resolve({ error: null });
    });

    const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof getSupabaseAdmin>);

    return {
      getCapturedData: () => capturedData,
      mockFrom,
      mockInsert,
    };
  }

  // Generators for valid signup data

  // fullName: 2-100 characters, alphanumeric with spaces (realistic names)
  const fullNameArb = fc
    .string({ minLength: 2, maxLength: 100 })
    .filter((s) => s.trim().length >= 2);

  // Custom email generator that produces emails Zod's validator will accept.
  // Zod rejects some RFC-valid emails (e.g., those with ! or leading dots in local part).
  // We generate safe alphanumeric local parts with optional dots (not leading/trailing/consecutive).
  const emailArb = fc
    .tuple(
      fc.stringMatching(/^[a-z][a-z0-9]{0,15}(\.[a-z][a-z0-9]{0,7})?$/),
      fc.stringMatching(/^[a-z][a-z0-9]{0,10}\.[a-z]{2,4}$/),
    )
    .map(([local, domain]) => `${local}@${domain}`);

  const userTypeArb = fc.constantFrom('sender' as const, 'business' as const, 'driver' as const);

  const sourceArb = fc.constantFrom('home', 'campaign-lagos', 'campaign-drivers', 'campaign-referral');

  // Property 1: Waitlist signup data persistence round-trip
  // For any valid waitlist signup (fullName of 2–100 chars, well-formed email,
  // userType in {sender, business, driver}), submitting the form action SHALL
  // successfully store the data in Supabase and the stored record SHALL contain
  // the same fullName, email, and userType that were submitted.
  /**
   * **Validates: Requirements 5.3, 5.6**
   */
  describe('Property 1: Waitlist signup data persistence round-trip', () => {
    it('valid signup data is persisted correctly to Supabase', async () => {
      await fc.assert(
        fc.asyncProperty(
          fullNameArb,
          emailArb,
          userTypeArb,
          sourceArb,
          async (fullName, email, userType, source) => {
            // Set up fresh mock for each iteration
            const { getCapturedData, mockFrom } = setupSupabaseMock();

            const request = createFormRequest({ fullName, email, userType, source });

            const response = await action({
              request,
              params: {},
              context: {},
            } as unknown as Parameters<typeof action>[0]);

            // React Router v7's data() returns { type: "DataWithResponseInit", data: {...}, init: {...} }
            const actionResult = (response as unknown as { data: { success: boolean; message?: string } }).data;

            // The action should succeed for valid data
            expect(actionResult.success).toBe(true);

            // Verify Supabase was called with the correct table
            expect(mockFrom).toHaveBeenCalledWith('waitlist_signups');

            // Verify the stored record matches submitted data (round-trip)
            const capturedData = getCapturedData();
            expect(capturedData).not.toBeNull();
            expect(capturedData!.full_name).toBe(fullName);
            expect(capturedData!.email).toBe(email);
            expect(capturedData!.user_type).toBe(userType);
            expect(capturedData!.source).toBe(source);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

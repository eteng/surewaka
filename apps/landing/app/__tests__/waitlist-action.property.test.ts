// Feature: surewaka-landing-page, Property 1: Waitlist signup data persistence round-trip
// Validates: Requirements 5.3, 5.6

import { describe, it, expect, vi } from 'vitest';
import * as fc from 'fast-check';

const mockDbInsert = vi.fn();

vi.mock('@surewaka/db', () => ({
  db: {
    insert: (...args: unknown[]) => mockDbInsert(...args),
  },
  waitlistSignups: 'waitlist_signups',
}));

import { action } from '../routes/home';

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
   * Helper: set up the db mock and return a reference to capture insert values.
   */
  function setupDbMock() {
    let capturedValues: Record<string, unknown> | null = null;

    const mockValues = vi.fn().mockImplementation((data: Record<string, unknown>) => {
      capturedValues = data;
      return Promise.resolve([]);
    });

    mockDbInsert.mockReturnValue({ values: mockValues });

    return {
      getCapturedValues: () => capturedValues,
      mockValues,
    };
  }

  // Generators for valid signup data

  // fullName: 2-100 characters, alphanumeric with spaces (realistic names)
  const fullNameArb = fc
    .string({ minLength: 2, maxLength: 100 })
    .filter((s) => s.trim().length >= 2);

  // Custom email generator that produces emails Zod's validator will accept.
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
  // successfully store the data in the database and the stored record SHALL contain
  // the same fullName, email, and userType that were submitted.
  /**
   * **Validates: Requirements 5.3, 5.6**
   */
  describe('Property 1: Waitlist signup data persistence round-trip', () => {
    it('valid signup data is persisted correctly to the database', async () => {
      await fc.assert(
        fc.asyncProperty(
          fullNameArb,
          emailArb,
          userTypeArb,
          sourceArb,
          async (fullName, email, userType, source) => {
            // Set up fresh mock for each iteration
            const { getCapturedValues, mockValues } = setupDbMock();

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

            // Verify db.insert was called with the waitlist table
            expect(mockDbInsert).toHaveBeenCalledWith('waitlist_signups');

            // Verify values were called once
            expect(mockValues).toHaveBeenCalledOnce();

            // Verify the stored record matches submitted data (round-trip, camelCase keys)
            const capturedValues = getCapturedValues();
            expect(capturedValues).not.toBeNull();
            expect(capturedValues!.fullName).toBe(fullName);
            expect(capturedValues!.email).toBe(email);
            expect(capturedValues!.userType).toBe(userType);
            expect(capturedValues!.source).toBe(source);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});

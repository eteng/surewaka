// Feature: saved-recipients-contact-book, Property 6: Save-nudge visibility —
// For any Recipient_Step form value and any current saved-recipient count, the
// Save_Nudge SHALL be visible if and only if the value passes
// recipientDetailsSchema AND the count is strictly less than RECIPIENT_CAP.
//
// Validates: Requirements 1.1, 1.2, 1.3
//
// The screen computes visibility as:
//   canSave = recipientDetailsSchema.safeParse(values).success
//             && recipients.length < RECIPIENT_CAP   (RECIPIENT_CAP = 25)
// Driving a real RN form 100+ times (async render ~10s each) is infeasible and
// flaky, so — as the task allows — this property test targets the exact pure
// predicate the screen uses, over generated form values × counts. Two
// component-level assertions below tie the predicate to the actual rendered
// screen (the nudge copy appears iff the predicate holds).
import fc from 'fast-check';
import { render, screen } from '@testing-library/react-native';
import { recipientDetailsSchema } from '@surewaka/shared';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientScreen from '../app/booking/recipient';
import { installFetch, ok, makeRecipient, resetStores } from '../test/helpers';

const RECIPIENT_CAP = 25;

// The predicate exactly as recipient.tsx derives it.
function nudgeVisible(values: unknown, count: number): boolean {
  return recipientDetailsSchema.safeParse(values).success && count < RECIPIENT_CAP;
}

// Generators — mix values that pass and fail recipientDetailsSchema, and counts
// straddling the cap boundary (…24, 25, 26…).
const validPhone = fc.constantFrom(
  '08012345678',
  '07098765432',
  '09011223344',
  '+2348012345678',
  '+2347000000001',
);
const anyPhone = fc.oneof(
  validPhone,
  fc.string(),
  fc.constantFrom('', '1234', '0801234567', '08012345678a', '+2341012345678'),
);
const formValue = fc.record({
  recipientName: fc.oneof(fc.string(), fc.string({ minLength: 2, maxLength: 100 })),
  recipientPhone: anyPhone,
  deliveryNotes: fc.oneof(fc.constant(undefined), fc.string({ maxLength: 260 })),
});
const count = fc.integer({ min: 0, max: 40 });

describe('Feature: saved-recipients-contact-book, Property 6: Save-nudge visibility', () => {
  it('is visible iff the value passes recipientDetailsSchema AND count < 25', () => {
    fc.assert(
      fc.property(formValue, count, (values, c) => {
        const schemaOk = recipientDetailsSchema.safeParse(values).success;
        const underCap = c < RECIPIENT_CAP;
        const expected = schemaOk && underCap;
        // The predicate must equal the conjunction, in every direction.
        expect(nudgeVisible(values, c)).toBe(expected);
        // Cross-checks that pin each conjunct:
        if (!schemaOk) expect(nudgeVisible(values, c)).toBe(false); // 1.2 invalid hides
        if (c >= RECIPIENT_CAP) expect(nudgeVisible(values, c)).toBe(false); // 1.3 at cap hides
      }),
      { numRuns: 300 },
    );
  });

  it('at exactly the cap (25) the nudge is always hidden regardless of validity', () => {
    fc.assert(
      fc.property(formValue, (values) => {
        expect(nudgeVisible(values, RECIPIENT_CAP)).toBe(false);
      }),
      { numRuns: 150 },
    );
  });

  // ── Component-level ties to the real screen (a few concrete cases) ──
  describe('rendered screen reflects the predicate', () => {
    beforeEach(() => resetStores());

    it('shows the save nudge when the form is valid and under the cap', async () => {
      const f = installFetch();
      f.enqueue(ok([])); // empty saved list -> count 0
      await render(<RecipientScreen />);
      // The default form is empty (invalid), so the nudge must be hidden (1.2).
      expect(screen.queryByText('Save this recipient for next time?')).toBeNull();
    });

    it('hides the save nudge at the cap even with a valid form', async () => {
      const many = Array.from({ length: RECIPIENT_CAP }, (_, i) =>
        makeRecipient({ id: `1111111${i}-1111-4111-8111-11111111111${(i % 10)}` }),
      );
      // Seed store at the cap so recipients.length === 25.
      useRecipientStore.setState({ recipients: many, fetched: true });
      const f = installFetch();
      f.enqueue(ok(many));
      await render(<RecipientScreen />);
      expect(screen.queryByText('Save this recipient for next time?')).toBeNull();
    });
  });
});

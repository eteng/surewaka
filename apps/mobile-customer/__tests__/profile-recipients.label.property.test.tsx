// Feature: saved-recipients-contact-book, Property 8: Primary-label derivation —
// For any Saved_Recipient, the primary text shown on the Profile_Recipients_Screen
// row SHALL equal the recipient's `label` when a non-empty label is set, and
// SHALL equal the recipient's `recipientName` otherwise.
//
// Validates: Requirements 3.2
//
// The screen renders each row's primary text as `item.label || item.recipientName`
// (a falsy/empty label falls back to the name). This is a component-level property
// test: for each generated SavedRecipient we seed the store (fetched:true so no
// network), render the real screen, and assert the derived primary text is present
// and equals the expected derivation. Rendering is read-only (no async event
// handler), so many iterations co-exist safely in one file.
import fc from 'fast-check';
import { render, screen, cleanup } from '@testing-library/react-native';
import type { SavedRecipient } from '@surewaka/shared';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientsScreen from '../app/profile/recipients';
import { resetStores } from '../test/helpers';

// The exact derivation the row uses.
function primaryText(r: SavedRecipient): string {
  return r.label || r.recipientName;
}

// Static screen copy we must not collide with when asserting by text.
const STATIC = new Set([
  'Saved Recipients',
  'No saved recipients',
  'Save the people you send to for faster booking.',
  '+ Add New Recipient',
  '←',
  '🗑',
  '👤',
]);

const nameArb = fc
  .string({ minLength: 2, maxLength: 100 })
  .filter((s) => s.trim().length >= 2 && !STATIC.has(s));
// A phone that is visually distinct from the primary text so queries are unambiguous.
const phoneArb = fc.constantFrom('08012345678', '07098765432', '09011223344', '+2348012345678');
// label: undefined, empty string (falls back), or a non-empty string (used as-is).
const labelArb = fc.oneof(
  fc.constant(undefined),
  fc.constant(''),
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length >= 1 && !STATIC.has(s)),
);
const recipientArb: fc.Arbitrary<SavedRecipient> = fc.record({
  id: fc.uuid(),
  recipientName: nameArb,
  recipientPhone: phoneArb,
  deliveryNotes: fc.constant(undefined),
  label: labelArb,
  created_at: fc.constant('2025-01-01T00:00:00.000Z'),
});

describe('Feature: saved-recipients-contact-book, Property 8: Primary-label derivation', () => {
  it('row primary text == label when non-empty else recipientName', async () => {
    await fc.assert(
      fc.asyncProperty(recipientArb, async (r) => {
        await cleanup();
        resetStores();
        // Seed store as already-fetched so the screen skips the network load.
        useRecipientStore.setState({ recipients: [r], fetched: true });

        await render(<RecipientsScreen />);

        const expected = primaryText(r);
        // Pure derivation cross-check.
        if (r.label && r.label.length > 0) {
          expect(expected).toBe(r.label);
        } else {
          expect(expected).toBe(r.recipientName);
        }
        // The derived primary text is actually rendered on the row.
        expect(await screen.findByText(expected)).toBeOnTheScreen();
      }),
      { numRuns: 100 },
    );
  }, 180_000);
});

// Feature: saved-recipients-contact-book, Property 7: Quick-select prefill
// correctness — For any Saved_Recipient, selecting it via a Quick_Select_Chip
// SHALL populate the Recipient_Step form fields such that recipientName,
// recipientPhone and deliveryNotes equal exactly the corresponding values of the
// selected Saved_Recipient, without creating a delivery or advancing the step.
//
// Validates: Requirements 2.3, 2.5
//
// This is a component-level property test: for each generated SavedRecipient we
// render the real booking screen, tap its chip, then assert the three RHF-backed
// TextInputs hold exactly the recipient's values and that neither router.push
// (advance/create-delivery) nor the recipients client create endpoint was hit.
import fc from 'fast-check';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react-native';
import type { SavedRecipient } from '@surewaka/shared';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientScreen from '../app/booking/recipient';
import { installFetch, ok, resetStores } from '../test/helpers';

// Generators for a valid SavedRecipient (name 2–100, valid NG phone, notes ≤200).
// Avoid names that collide with the screen's static copy (which would make
// findByText ambiguous); collisions are irrelevant to the prefill property.
const STATIC_UI_TEXT = new Set([
  'Recipient Details',
  'Recipient Name',
  'Recipient Phone',
  'Delivery Notes',
  'Continue',
  'Saved Recipients',
  'Save recipient',
  'Save this recipient for next time?',
  'Retry',
  "Couldn't load saved recipients",
  '+234',
]);
const nameArb = fc
  .string({ minLength: 2, maxLength: 100 })
  .filter((s) => s.trim().length >= 2 && !STATIC_UI_TEXT.has(s));
const phoneArb = fc.constantFrom(
  '08012345678',
  '07098765432',
  '09011223344',
  '+2348012345678',
  '+2347000000001',
  '08100000000',
);
const notesArb = fc.oneof(fc.constant(undefined), fc.string({ maxLength: 200 }));
const savedRecipientArb: fc.Arbitrary<SavedRecipient> = fc.record({
  id: fc.uuid(),
  recipientName: nameArb,
  recipientPhone: phoneArb,
  deliveryNotes: notesArb,
  label: fc.oneof(
    fc.constant(undefined),
    fc.string({ maxLength: 50 }).filter((s) => !STATIC_UI_TEXT.has(s)),
  ),
  created_at: fc.constant('2025-01-01T00:00:00.000Z'),
});

function inputByPlaceholder(placeholder: string) {
  return screen.getByPlaceholderText(placeholder);
}

describe('Feature: saved-recipients-contact-book, Property 7: Quick-select prefill correctness', () => {
  it('tapping a chip prefills exactly the recipient fields with no navigation/create', async () => {
    await fc.assert(
      fc.asyncProperty(savedRecipientArb, async (r) => {
        await cleanup(); // tear down the previous iteration's tree first
        resetStores();
        // Seed the store so the chip renders; stub list load to that single item.
        useRecipientStore.setState({ recipients: [r], fetched: true });
        const f = installFetch();
        f.enqueue(ok([r]));

        await render(<RecipientScreen />);
        // The chip label is `label` (if non-empty) else recipientName.
        const chipText = r.label && r.label.trim() ? r.label : r.recipientName;
        const chip = await screen.findByText(chipText);
        fireEvent.press(chip);

        // The three RHF-backed inputs must equal the recipient's values exactly.
        // reset() triggers a re-render; waitFor lets the new values settle.
        await waitFor(() => {
          expect(inputByPlaceholder('Who should the driver ask for?').props.value).toBe(
            r.recipientName,
          );
        });
        expect(inputByPlaceholder('08012345678').props.value).toBe(r.recipientPhone);
        expect(inputByPlaceholder('Any instructions for the driver? (optional)').props.value).toBe(
          r.deliveryNotes ?? '',
        );

        // No navigation (2.5): tapping a chip must not advance the booking step.
        expect((global as any).__expoRouterMock.push).not.toHaveBeenCalled();
        // No create side-effect (2.5): the only fetch was the initial list GET.
        const posts = f.calls.filter((c) => c.method === 'POST');
        expect(posts).toHaveLength(0);
      }),
      { numRuns: 100 },
    );
  }, 180_000);
});

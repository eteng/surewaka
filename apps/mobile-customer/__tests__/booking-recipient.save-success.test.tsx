// Task 7.4 (part 2 of 3) — Save_Nudge success path for
// app/booking/recipient.tsx.
//
// Activating the nudge creates the recipient with the current form fields + a
// label (1.4); on success it shows "Saved ✓", adds the recipient to the store,
// and the booking flow can continue uninterrupted (1.5).
//
// This lives in its own file: the Save nudge is an async event handler that
// reads react-hook-form watch() and then setState-s, and test-renderer@1.x +
// React 19.2 does not fully reset its reconciler between such async-interaction
// renders within one file. jest's per-file module isolation gives this test a
// clean reconciler. Production code is unchanged.
//
// _Requirements: 1.4, 1.5
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientScreen from '../app/booking/recipient';
import { installFetch, ok, makeRecipient, resetStores } from '../test/helpers';

const captureException = Sentry.captureException as jest.Mock;
const NAME = 'Who should the driver ask for?';
const PHONE = '08012345678';
const NOTES = 'Any instructions for the driver? (optional)';

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('activating the nudge creates the recipient with fields + label, shows "Saved ✓", adds to the store, and lets the flow continue (1.4, 1.5)', async () => {
  const f = installFetch();
  f.enqueue(ok([])); // initial list load
  await render(<RecipientScreen />);
  await waitFor(() => expect(screen.queryByText('Loading saved recipients...')).toBeNull());

  fireEvent.changeText(screen.getByPlaceholderText(NAME), 'Bola Ade');
  fireEvent.changeText(screen.getByPlaceholderText(PHONE), '08012345678');
  fireEvent.changeText(screen.getByPlaceholderText(NOTES), 'Leave at gate');
  await waitFor(() => {
    expect(screen.getByText('Save this recipient for next time?')).toBeOnTheScreen();
  });

  // Enqueue the create response (201).
  const created = makeRecipient({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', label: 'Bola Ade' });
  f.enqueue(ok(created), { ok: true, status: 201 });

  fireEvent.press(screen.getByText('Save recipient'));
  expect(await screen.findByText('Saved ✓')).toBeOnTheScreen();

  // create() POSTed exactly the current form fields + a label (1.4). When the
  // optional label field is left blank the screen falls back to recipientName,
  // so the body carries all four fields with a non-empty label.
  const post = f.calls.find((c) => c.method === 'POST');
  expect(post).toBeDefined();
  expect(post!.url).toContain('/api/v1/recipients');
  expect(post!.body).toEqual({
    recipientName: 'Bola Ade',
    recipientPhone: '08012345678',
    deliveryNotes: 'Leave at gate',
    label: 'Bola Ade',
  });

  // Added to the store (1.5).
  expect(useRecipientStore.getState().recipients).toContainEqual(created);

  // Flow can continue uninterrupted (1.5): the Continue action remains present
  // and enabled after saving — the nudge did not block or replace the flow.
  expect(screen.getByText('Continue')).toBeOnTheScreen();

  // No error reported on the happy path.
  expect(captureException).not.toHaveBeenCalled();
});

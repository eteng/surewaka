// Task 9.2 (part 2) — recipient-edit.tsx new-mode save -> create (3.4).
//
// With no id (new mode) a valid submit calls createRecipientsClient.create
// (POST, no id in the URL), adds the result to the store, and navigates back.
// Own file (async submit handler) — see the note in
// booking-recipient.save-success.test.tsx.
//
// _Requirements: 3.4
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientEditScreen from '../app/profile/recipient-edit';
import { installFetch, ok, resetStores } from '../test/helpers';

const captureException = Sentry.captureException as jest.Mock;
const NAME = 'Who should the driver ask for?';
const PHONE = '08012345678';

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('new mode: valid submit creates via POST (no id), updates the store, and navigates back (3.4)', async () => {
  (global as any).__setSearchParams({}); // new mode — no id
  const f = installFetch();
  await render(<RecipientEditScreen />);

  // Fill a valid form (label is optional and left unset here).
  fireEvent.changeText(screen.getByPlaceholderText(NAME), 'Bola Ade');
  fireEvent.changeText(screen.getByPlaceholderText(PHONE), '08012345678');
  await waitFor(() => expect(screen.getByPlaceholderText(NAME).props.value).toBe('Bola Ade'));

  // Enqueue the create (201) response.
  const created = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    recipientName: 'Bola Ade',
    recipientPhone: '08012345678',
    deliveryNotes: '',
    created_at: '2025-01-01T00:00:00.000Z',
  };
  f.enqueue(ok(created), { ok: true, status: 201 });

  fireEvent.press(screen.getByText('Save Recipient'));

  // Navigates back on success (3.4).
  await waitFor(() => expect((global as any).__expoRouterMock.back).toHaveBeenCalled());

  // A POST (create) to the COLLECTION endpoint — no id in the URL (3.4).
  const post = f.calls.find((c) => c.method === 'POST');
  expect(post).toBeDefined();
  expect(post!.url).toMatch(/\/api\/v1\/recipients$/);
  expect(post!.body).toMatchObject({
    recipientName: 'Bola Ade',
    recipientPhone: '08012345678',
  });
  // Create must NOT carry an id, and must not be a PUT/PATCH.
  expect((post!.body as any).id).toBeUndefined();
  expect(f.calls.find((c) => c.method === 'PUT')).toBeUndefined();
  expect(f.calls.find((c) => c.method === 'PATCH')).toBeUndefined();

  // Store updated with the created recipient (3.4).
  expect(useRecipientStore.getState().recipients).toContainEqual(created);
  // No error on success.
  expect(captureException).not.toHaveBeenCalled();
});

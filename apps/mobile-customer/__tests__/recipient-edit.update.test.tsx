// Task 9.2 (part 3) — recipient-edit.tsx edit-mode save -> update via PUT (3.4).
//
// In edit mode a valid submit calls createRecipientsClient.update (PUT with the
// id in the URL — standardized on PUT, not PATCH), updates the store, and
// navigates back. Own file (async submit handler).
//
// _Requirements: 3.4
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientEditScreen from '../app/profile/recipient-edit';
import { installFetch, ok, makeRecipient, resetStores } from '../test/helpers';

const captureException = Sentry.captureException as jest.Mock;
const NAME = 'Who should the driver ask for?';
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('edit mode: valid submit updates via PUT (with id), updates the store, and navigates back (3.4)', async () => {
  // Seed the store so the update is observable, and set edit-mode params.
  useRecipientStore.setState({
    recipients: [makeRecipient({ id: ID, label: 'Home', recipientName: 'Old Name' })],
    fetched: true,
  });
  (global as any).__setSearchParams({ id: ID });

  const f = installFetch();
  // First fetch = the edit-mode get() prefill.
  f.enqueue(
    ok({
      id: ID,
      recipientName: 'Old Name',
      recipientPhone: '08012345678',
      deliveryNotes: 'Gate',
      label: 'Home',
      created_at: '2025-01-01T00:00:00.000Z',
    }),
  );

  await render(<RecipientEditScreen />);
  await waitFor(() => expect(screen.getByPlaceholderText(NAME).props.value).toBe('Old Name'));

  // Edit the name.
  fireEvent.changeText(screen.getByPlaceholderText(NAME), 'New Name');
  await waitFor(() => expect(screen.getByPlaceholderText(NAME).props.value).toBe('New Name'));

  // Enqueue the update (200) response.
  const updated = {
    id: ID,
    recipientName: 'New Name',
    recipientPhone: '08012345678',
    deliveryNotes: 'Gate',
    label: 'Home',
    created_at: '2025-01-01T00:00:00.000Z',
  };
  f.enqueue(ok(updated), { ok: true, status: 200 });

  fireEvent.press(screen.getByText('Update Recipient'));

  await waitFor(() => expect((global as any).__expoRouterMock.back).toHaveBeenCalled());

  // A PUT (update) to the id endpoint — NOT PATCH, NOT POST.
  const put = f.calls.find((c) => c.method === 'PUT');
  expect(put).toBeDefined();
  expect(put!.url).toContain(`/api/v1/recipients/${ID}`);
  expect(put!.body).toMatchObject({ recipientName: 'New Name', label: 'Home' });
  expect(f.calls.find((c) => c.method === 'PATCH')).toBeUndefined();
  expect(f.calls.find((c) => c.method === 'POST')).toBeUndefined();

  // Store updated in place.
  const inStore = useRecipientStore.getState().recipients.find((r) => r.id === ID);
  expect(inStore?.recipientName).toBe('New Name');

  expect(captureException).not.toHaveBeenCalled();
});

// Task 8.3 (part 3) — profile/recipients.tsx delete confirmation + success
// (3.5, 3.6). Deleting a row requires an explicit Alert confirmation before the
// DELETE request; on success the row is removed from the list via the store.
//
// The jest.setup Alert mock auto-presses the destructive ("Delete") button so
// the confirmation proceeds. Own file (async delete handler) — see the note in
// profile-recipients.states.test.tsx.
//
// _Requirements: 3.5, 3.6
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientsScreen from '../app/profile/recipients';
import { installFetch, ok, makeRecipient, resetStores } from '../test/helpers';

const captureException = Sentry.captureException as jest.Mock;
const alertSpy = Alert.alert as jest.Mock;

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('requires an Alert confirmation before delete, then removes the row on success (3.5, 3.6)', async () => {
  const target = makeRecipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Mum' });
  const other = makeRecipient({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Office' });
  useRecipientStore.setState({ recipients: [target, other], fetched: true });

  const f = installFetch();
  await render(<RecipientsScreen />);
  expect(await screen.findByText('Mum')).toBeOnTheScreen();

  // The delete request will succeed (DELETE -> { data: null }).
  f.enqueue(ok(null));

  // Press the row's trash icon. The Alert mock auto-presses the destructive
  // "Delete" confirm button.
  fireEvent.press(screen.getAllByText('🗑')[0]);

  // An explicit confirmation Alert was shown before deleting (3.5).
  expect(alertSpy).toHaveBeenCalled();
  const [title, message, buttons] = alertSpy.mock.calls[0];
  expect(title).toBe('Delete Recipient');
  expect(String(message)).toContain('Mum');
  expect(buttons.some((b: any) => b.style === 'destructive')).toBe(true);
  expect(buttons.some((b: any) => b.style === 'cancel')).toBe(true);

  // On success the row is removed from the list via the store (3.6).
  await waitFor(() => {
    expect(useRecipientStore.getState().recipients.map((r) => r.id)).toEqual([other.id]);
  });
  await waitFor(() => expect(screen.queryByText('Mum')).toBeNull());
  expect(screen.getByText('Office')).toBeOnTheScreen();

  // A DELETE was issued to the recipient's id.
  const del = f.calls.find((c) => c.method === 'DELETE');
  expect(del?.url).toContain(`/api/v1/recipients/${target.id}`);

  // No error surfaced on success (3.8).
  expect(captureException).not.toHaveBeenCalled();
});

// Task 8.3 (part 4) — profile/recipients.tsx delete failure (3.7).
//
// If the DELETE fails, the row remains visible in the list, a failure message
// is surfaced (a second Alert), and the error is reported to Sentry tagged
// app:mobile-customer. Own file (async delete handler) — see the note in
// profile-recipients.states.test.tsx.
//
// _Requirements: 3.7
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientsScreen from '../app/profile/recipients';
import { installFetch, errBody, makeRecipient, resetStores } from '../test/helpers';

const captureException = Sentry.captureException as jest.Mock;
const alertSpy = Alert.alert as jest.Mock;

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('on delete failure keeps the item, surfaces a message, and reports Sentry app:mobile-customer (3.7)', async () => {
  const target = makeRecipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Mum' });
  useRecipientStore.setState({ recipients: [target], fetched: true });

  const f = installFetch();
  await render(<RecipientsScreen />);
  expect(await screen.findByText('Mum')).toBeOnTheScreen();

  // The delete request will fail.
  f.enqueue(errBody('SERVER_ERROR', 'nope'), { ok: false, status: 500 });

  // Press trash -> Alert mock auto-presses destructive "Delete".
  fireEvent.press(screen.getByText('🗑'));

  // Failure reported to Sentry, tagged app:mobile-customer (3.7).
  await waitFor(() => expect(captureException).toHaveBeenCalled());
  const call = captureException.mock.calls.at(-1)!;
  expect(call[1].tags.app).toBe('mobile-customer');

  // A failure message is attempted (a second Alert: the confirm + the error).
  await waitFor(() => {
    const errorAlert = alertSpy.mock.calls.find(([t]) => t === 'Error');
    expect(errorAlert).toBeDefined();
  });

  // The item REMAINS in the list/store (3.7).
  expect(useRecipientStore.getState().recipients.map((r) => r.id)).toEqual([target.id]);
  expect(screen.getByText('Mum')).toBeOnTheScreen();
});

// Task 8.3 (part 2) — profile/recipients.tsx list-load error + Retry (8.3).
//
// If loading the list fails, the screen shows an error message with a Retry
// action that re-requests the list. Own file (async retry handler) — see the
// note in profile-recipients.states.test.tsx.
//
// _Requirements: 8.3
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import RecipientsScreen from '../app/profile/recipients';
import { installFetch, ok, errBody, makeRecipient, resetStores } from '../test/helpers';

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('on list-load failure shows an error message + Retry that re-requests the list (8.3)', async () => {
  const f = installFetch();
  f.enqueue(errBody('SERVER_ERROR', 'boom'), { ok: false, status: 500 }); // initial load fails
  await render(<RecipientsScreen />);

  expect(await screen.findByText('Failed to load recipients')).toBeOnTheScreen();
  const retry = screen.getByText('Retry');
  expect(retry).toBeOnTheScreen();

  // Retry re-requests the list; this time it succeeds and renders the row.
  f.enqueue(ok([makeRecipient({ label: 'Retried' })]));
  fireEvent.press(retry);

  expect(await screen.findByText('Retried')).toBeOnTheScreen();
  // Error message cleared after a successful retry.
  expect(screen.queryByText('Failed to load recipients')).toBeNull();
  // Two GETs total (initial + retry).
  expect(f.calls.filter((c) => c.method === 'GET')).toHaveLength(2);
});

// Task 7.4 (part 3 of 3) — Save_Nudge failure path for
// app/booking/recipient.tsx.
//
// If the create request fails, the screen shows a visible failure message,
// lets the booking flow continue, does NOT mutate the store, and reports the
// error to Sentry tagged app:mobile-customer (1.6).
//
// Own file — see the note in booking-recipient.save-success.test.tsx.
//
// _Requirements: 1.6
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientScreen from '../app/booking/recipient';
import { installFetch, ok, errBody, resetStores } from '../test/helpers';

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

it('on create failure shows a visible message, lets the flow continue, and reports Sentry (1.6)', async () => {
  const f = installFetch();
  f.enqueue(ok([]));
  await render(<RecipientScreen />);
  await waitFor(() => expect(screen.queryByText('Loading saved recipients...')).toBeNull());

  fireEvent.changeText(screen.getByPlaceholderText(NAME), 'Bola Ade');
  fireEvent.changeText(screen.getByPlaceholderText(PHONE), '08012345678');
  fireEvent.changeText(screen.getByPlaceholderText(NOTES), 'Leave at gate');
  await waitFor(() => {
    expect(screen.getByText('Save recipient')).toBeOnTheScreen();
  });

  // Create fails (500).
  f.enqueue(errBody('SERVER_ERROR', 'nope'), { ok: false, status: 500 });
  fireEvent.press(screen.getByText('Save recipient'));

  // The failed create was reported to Sentry (this settles the async handler).
  await waitFor(() => expect(captureException).toHaveBeenCalled());

  // The failure branch sets `saveError` after the awaited create() with no store
  // mutation, so — unlike the success path (which re-renders via
  // useRecipientStore.add) — nothing forces the screen to commit that trailing
  // state. Trigger a benign committed re-render by writing the store to its
  // current value inside act(); the screen subscribes to `recipients`, flushing
  // the pending setSaveError(true).
  await act(async () => {
    const current = useRecipientStore.getState().recipients;
    useRecipientStore.setState({ recipients: [...current] });
  });

  // The inline failure message must be visible while the nudge remains.
  expect(screen.getByText(/You can still continue/)).toBeOnTheScreen();

  // Sentry reported, tagged app:mobile-customer.
  const call = captureException.mock.calls.at(-1)!;
  expect(call[1].tags.app).toBe('mobile-customer');

  // Store NOT mutated on failure.
  expect(useRecipientStore.getState().recipients).toHaveLength(0);

  // Flow continues uninterrupted (1.6): the Continue action remains present.
  expect(screen.getByText('Continue')).toBeOnTheScreen();
});

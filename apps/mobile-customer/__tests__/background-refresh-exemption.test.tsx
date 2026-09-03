// Task 10.2 — background-operation exemption (8.8).
//
// A BACKGROUND (non-user-initiated) refresh of the saved recipients — i.e. a
// direct useRecipientStore.fetch() not triggered by an explicit user action —
// whose request FAILS surfaces NO user-facing feedback: no Alert, no visible
// error affordance, and no Sentry report from the refresh itself. This is
// distinct from the USER-INITIATED load-error affordance (retry + Sentry) that
// the Recipient_Step presents on its own mount-time load failure (2.6, 8.5).
//
// _Requirements: 8.8
import { render, screen, waitFor, cleanup } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientScreen from '../app/booking/recipient';
import { installFetch, ok, errBody, makeRecipient, resetStores } from '../test/helpers';

const captureException = Sentry.captureException as jest.Mock;
const alertSpy = Alert.alert as jest.Mock;

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('a background store.fetch() failure surfaces NO user-facing feedback and no Sentry (8.8)', async () => {
  // Seed some already-loaded recipients so the screen is in a normal state.
  const seeded = [makeRecipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Mum' })];
  useRecipientStore.setState({ recipients: seeded, fetched: true });

  const f = installFetch();
  // The screen's own mount load (user-initiated) succeeds and returns the list,
  // so the screen never shows its own error affordance in this test.
  f.enqueue(ok(seeded));
  await render(<RecipientScreen />);
  await waitFor(() => expect(screen.queryByText('Loading saved recipients...')).toBeNull());
  expect(await screen.findByText('Mum')).toBeOnTheScreen();

  // Baseline: nothing surfaced from the successful load.
  const alertsBefore = alertSpy.mock.calls.length;
  const sentryBefore = captureException.mock.calls.length;

  // Now perform a BACKGROUND refresh directly on the store (NOT via any user
  // action / affordance) and make it FAIL at the transport level.
  f.failNetwork();
  const { error } = await useRecipientStore.getState().fetch('test-token');

  // The refresh failed…
  expect(error).toBeTruthy();
  // …but the store left its state intact (no wipe) — the caller can decide.
  expect(useRecipientStore.getState().recipients).toEqual(seeded);
  expect(useRecipientStore.getState().fetched).toBe(true);

  // …and NO user-facing feedback was surfaced for the background failure:
  //   - no NEW Alert
  //   - no NEW visible error affordance on-screen
  //   - no NEW Sentry report attributable to the background refresh
  expect(alertSpy.mock.calls.length).toBe(alertsBefore);
  expect(captureException.mock.calls.length).toBe(sentryBefore);
  expect(screen.queryByText("Couldn't load saved recipients")).toBeNull();
  expect(screen.queryByText('Failed to load recipients')).toBeNull();
  // The screen still shows the (unchanged) data — no error UI took over.
  expect(screen.getByText('Mum')).toBeOnTheScreen();
});

it('CONTRAST: a USER-INITIATED mount load failure DOES surface an error affordance + Sentry (2.6, 8.5)', async () => {
  // This pins the distinction required by 8.8: the user-initiated path is NOT
  // silent — it shows a retry affordance and reports to Sentry.
  const f = installFetch();
  f.enqueue(errBody('SERVER_ERROR', 'boom'), { ok: false, status: 500 });
  await render(<RecipientScreen />);

  expect(await screen.findByText("Couldn't load saved recipients")).toBeOnTheScreen();
  expect(screen.getByText('Retry')).toBeOnTheScreen();
  expect(captureException).toHaveBeenCalledTimes(1);
  expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');
});

// Task 8.3 (part 1) — resilience/list states for app/profile/recipients.tsx
// that are read-only renders (no async event handler): loading indicator while
// loading (8.1), empty state (8.2), the add-new footer under the cap, and the
// max-reached footer + hidden add action at the cap (5.4), plus "no error shown
// on success / before any attempt" (3.8).
//
// The async event-handler flows (retry, delete success, delete failure) are in
// their own files (profile-recipients.retry / .delete-success / .delete-failure)
// because test-renderer@1.x + React 19.2 does not fully reset its reconciler
// between async-interaction renders within a single file.
//
// _Requirements: 3.8, 5.4, 8.1, 8.2
import { render, screen, waitFor, cleanup } from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import { useRecipientStore } from '@surewaka/mobile-shared';
import RecipientsScreen from '../app/profile/recipients';
import { installFetch, ok, makeRecipient, resetStores } from '../test/helpers';

const captureException = Sentry.captureException as jest.Mock;
const RECIPIENT_CAP = 25;

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('shows a loading indicator while loading the list (8.1)', async () => {
  // Store not yet fetched -> screen mounts in loading state and issues a GET.
  const f = installFetch();
  // Hold the list load open so the loading state is observable.
  let release: (v: unknown) => void = () => {};
  f.fn.mockImplementationOnce(() => new Promise((res) => { release = res; }));

  await render(<RecipientsScreen />);

  // While loading the screen renders the full-screen loading branch (an
  // ActivityIndicator), NOT the list header or empty copy. The loading branch
  // is exclusive of the loaded UI, so the absence of the loaded UI pins the
  // loading state.
  expect(screen.queryByText('Saved Recipients')).toBeNull(); // header only in loaded branch
  expect(screen.queryByText('No saved recipients')).toBeNull();

  // Once the load resolves, the loading branch is replaced by the loaded UI —
  // confirming the earlier state was indeed the loading state.
  await require('@testing-library/react-native').act(async () => {
    release({ ok: true, status: 200, json: async () => ok([]) });
  });
  expect(await screen.findByText('Saved Recipients')).toBeOnTheScreen();
});

it('shows an empty state prompting the user to add a recipient when there are zero (8.2)', async () => {
  useRecipientStore.setState({ recipients: [], fetched: true });
  await render(<RecipientsScreen />);
  expect(await screen.findByText('No saved recipients')).toBeOnTheScreen();
  expect(screen.getByText('Save the people you send to for faster booking.')).toBeOnTheScreen();
  // Add action is available (under cap).
  expect(screen.getByText('+ Add New Recipient')).toBeOnTheScreen();
  // No error surfaced before/without any mutation attempt (3.8).
  expect(captureException).not.toHaveBeenCalled();
});

it('shows the add-new footer action when under the cap (5.4)', async () => {
  useRecipientStore.setState({
    recipients: [makeRecipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Mum' })],
    fetched: true,
  });
  await render(<RecipientsScreen />);
  expect(await screen.findByText('+ Add New Recipient')).toBeOnTheScreen();
  expect(
    screen.queryByText(`You've reached the maximum of ${RECIPIENT_CAP} saved recipients`),
  ).toBeNull();
});

it('hides the add action and shows the max-reached message at the cap (5.4)', async () => {
  const many = Array.from({ length: RECIPIENT_CAP }, (_, i) =>
    makeRecipient({ id: `1111111${i}-1111-4111-8111-11111111111${i % 10}`, label: `R${i}` }),
  );
  useRecipientStore.setState({ recipients: many, fetched: true });
  await render(<RecipientsScreen />);

  expect(
    await screen.findByText(`You've reached the maximum of ${RECIPIENT_CAP} saved recipients`),
  ).toBeOnTheScreen();
  // Add action hidden at the cap.
  expect(screen.queryByText('+ Add New Recipient')).toBeNull();
});

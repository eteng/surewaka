// Task 9.2 (part 5) — recipient-edit.tsx save failure -> Alert + Sentry.
//
// If create/update fails, the screen surfaces an error Alert and reports the
// error to Sentry tagged app:mobile-customer, and does NOT navigate back. Own
// file (async submit handler).
//
// _Requirements: 3.4 (failure handling)
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import { Alert } from 'react-native';
import * as Sentry from '@sentry/react-native';
import RecipientEditScreen from '../app/profile/recipient-edit';
import { installFetch, errBody, resetStores } from '../test/helpers';

const captureException = Sentry.captureException as jest.Mock;
const alertSpy = Alert.alert as jest.Mock;
const NAME = 'Who should the driver ask for?';
const PHONE = '08012345678';

beforeEach(() => {
  resetStores();
  // This screen only uses Alert for the error message (no confirm to auto-press).
  (global as any).__setAlertAutoPress(false);
});
afterEach(async () => {
  await cleanup();
});

it('on create failure surfaces an error Alert, reports Sentry app:mobile-customer, and stays on screen', async () => {
  (global as any).__setSearchParams({}); // new mode
  const f = installFetch();
  await render(<RecipientEditScreen />);

  fireEvent.changeText(screen.getByPlaceholderText(NAME), 'Bola Ade');
  fireEvent.changeText(screen.getByPlaceholderText(PHONE), '08012345678');
  await waitFor(() => expect(screen.getByPlaceholderText(NAME).props.value).toBe('Bola Ade'));

  // Create fails.
  f.enqueue(errBody('SERVER_ERROR', 'nope'), { ok: false, status: 500 });
  fireEvent.press(screen.getByText('Save Recipient'));

  // Reported to Sentry, tagged app:mobile-customer.
  await waitFor(() => expect(captureException).toHaveBeenCalled());
  const call = captureException.mock.calls.at(-1)!;
  expect(call[1].tags.app).toBe('mobile-customer');

  // An error Alert was surfaced.
  await waitFor(() => {
    expect(alertSpy.mock.calls.some(([t]) => t === 'Error')).toBe(true);
  });

  // Did not navigate back on failure.
  expect((global as any).__expoRouterMock.back).not.toHaveBeenCalled();
});

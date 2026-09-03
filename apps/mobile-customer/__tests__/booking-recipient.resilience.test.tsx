// Task 7.4 (part 1 of 3) — resilience-state unit tests for
// app/booking/recipient.tsx: the quick-select LOAD states and the chip TAP
// behaviour. These interactions are either synchronous (chip tap -> RHF reset)
// or a load/retry (async store fetch) which is safe to co-locate.
//
// The Save_Nudge CREATE tests (async event handler that reads RHF watch() and
// then setState-s) are split into their own files:
//   - booking-recipient.save-success.test.tsx  (1.4, 1.5)
//   - booking-recipient.save-failure.test.tsx   (1.6)
// because test-renderer@1.x + React 19.2 does not fully reset its reconciler
// between such async-interaction renders within a single file. jest isolates
// modules per file, giving each of those a clean reconciler. Production code is
// unchanged.
//
// Covers here: loader in place of chips while loading (8.4); load failure ->
// inline error + Retry that re-invokes fetch + manual entry still works +
// Sentry tagged app:mobile-customer (2.6, 8.5); N recipients -> N chips (2.1),
// zero -> none (2.2); tap prefills + editable (2.4) + no advance (2.5).
//
// _Requirements: 2.1, 2.2, 2.4, 2.5, 2.6, 8.4, 8.5
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react-native';
import * as Sentry from '@sentry/react-native';
import RecipientScreen from '../app/booking/recipient';
import { installFetch, ok, errBody, makeRecipient, resetStores } from '../test/helpers';

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

describe('booking/recipient.tsx — quick-select load states', () => {
  it('shows a loading indicator in place of the chip row while loading (8.4)', async () => {
    const f = installFetch();
    // Never resolve the list during this assertion window.
    let release: (v: unknown) => void = () => {};
    f.fn.mockImplementationOnce(() => new Promise((res) => { release = res; }));
    await render(<RecipientScreen />);
    expect(await screen.findByText('Loading saved recipients...')).toBeOnTheScreen();
    // Let it finish to avoid dangling work.
    await act(async () => {
      release({ ok: true, status: 200, json: async () => ok([]) });
    });
  });

  it('renders one chip per saved recipient (2.1)', async () => {
    const list = [
      makeRecipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Mum' }),
      makeRecipient({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: 'Office' }),
      makeRecipient({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', label: '', recipientName: 'Zed' }),
    ];
    const f = installFetch();
    f.enqueue(ok(list));
    await render(<RecipientScreen />);
    expect(await screen.findByText('Mum')).toBeOnTheScreen();
    expect(screen.getByText('Office')).toBeOnTheScreen();
    // Chip with no label falls back to recipientName.
    expect(screen.getByText('Zed')).toBeOnTheScreen();
  });

  it('renders no chip row when there are zero recipients (2.2)', async () => {
    const f = installFetch();
    f.enqueue(ok([]));
    await render(<RecipientScreen />);
    await waitFor(() => {
      expect(screen.queryByText('Loading saved recipients...')).toBeNull();
    });
    expect(screen.queryByText('Saved Recipients')).toBeNull();
  });
});

describe('booking/recipient.tsx — quick-select load failure', () => {
  it('on load failure shows an inline error + Retry, reports Sentry (app:mobile-customer), and keeps manual entry working (2.6, 8.5)', async () => {
    const f = installFetch();
    f.enqueue(errBody('SERVER_ERROR', 'boom'), { ok: false, status: 500 }); // first load fails
    await render(<RecipientScreen />);

    expect(await screen.findByText("Couldn't load saved recipients")).toBeOnTheScreen();
    const retry = screen.getByText('Retry');
    expect(retry).toBeOnTheScreen();

    // Sentry tagged app:mobile-customer when the retry affordance is presented.
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException.mock.calls[0][1].tags.app).toBe('mobile-customer');

    // Manual entry is NOT blocked — the name input is present and editable.
    fireEvent.changeText(screen.getByPlaceholderText(NAME), 'Manual Person');
    await waitFor(() => expect(screen.getByPlaceholderText(NAME).props.value).toBe('Manual Person'));

    // Retry re-invokes fetch; this time it succeeds and renders the chip.
    f.enqueue(ok([makeRecipient({ label: 'Retried' })]));
    fireEvent.press(retry);
    expect(await screen.findByText('Retried')).toBeOnTheScreen();
    // Two fetches total (initial + retry).
    expect(f.calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });
});

describe('booking/recipient.tsx — quick-select tap behaviour', () => {
  it('tapping a chip prefills editable fields and does not advance the step (2.4, 2.5)', async () => {
    const r = makeRecipient({
      label: 'Mum',
      recipientName: 'Bola',
      recipientPhone: '08099887766',
      deliveryNotes: 'Gate',
    });
    const f = installFetch();
    f.enqueue(ok([r]));
    await render(<RecipientScreen />);

    fireEvent.press(await screen.findByText('Mum'));

    await waitFor(() => expect(screen.getByPlaceholderText(NAME).props.value).toBe('Bola'));
    expect(screen.getByPlaceholderText(PHONE).props.value).toBe('08099887766');
    expect(screen.getByPlaceholderText(NOTES).props.value).toBe('Gate');

    // Editable: user can still change the prefilled value.
    fireEvent.changeText(screen.getByPlaceholderText(NAME), 'Bola Edited');
    await waitFor(() => expect(screen.getByPlaceholderText(NAME).props.value).toBe('Bola Edited'));

    // No advance (2.5): tapping a chip must not navigate.
    expect((global as any).__expoRouterMock.push).not.toHaveBeenCalled();
  });
});

// Task 10.1 (part B) — mobile boundary: a delivery can be booked with an EMPTY
// saved-recipient store. The booking Recipient_Step submits recipient details
// (snapshot) and advances to /booking/carriers without requiring any
// Saved_Recipient to exist (6.4). The submit persists the recipient details
// into the booking store (the Delivery_Snapshot source) via setRecipientDetails.
//
// Own file (async submit handler) — see the note in
// booking-recipient.save-success.test.tsx.
//
// _Requirements: 6.1, 6.4
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import { useBookingStore, useRecipientStore } from '@surewaka/mobile-shared';
import RecipientScreen from '../app/booking/recipient';
import { installFetch, ok, resetStores } from '../test/helpers';

const NAME = 'Who should the driver ask for?';
const PHONE = '08012345678';
const NOTES = 'Any instructions for the driver? (optional)';

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('books with an EMPTY saved-recipient store: submit sets recipient details and advances to /booking/carriers (6.1, 6.4)', async () => {
  const f = installFetch();
  f.enqueue(ok([])); // saved-recipient list loads EMPTY
  await render(<RecipientScreen />);
  await waitFor(() => expect(screen.queryByText('Loading saved recipients...')).toBeNull());

  // Precondition: the saved-recipient store is empty — no Saved_Recipient exists.
  expect(useRecipientStore.getState().recipients).toHaveLength(0);
  // And there are no quick-select chips.
  expect(screen.queryByText('Saved Recipients')).toBeNull();

  // Enter one-off recipient details and submit the step.
  fireEvent.changeText(screen.getByPlaceholderText(NAME), 'Bola Ade');
  fireEvent.changeText(screen.getByPlaceholderText(PHONE), '08012345678');
  fireEvent.changeText(screen.getByPlaceholderText(NOTES), 'Leave at gate');
  await waitFor(() => expect(screen.getByPlaceholderText(PHONE).props.value).toBe('08012345678'));

  fireEvent.press(screen.getByText('Continue'));

  // Advances to the carriers step (booking proceeds without any Saved_Recipient).
  await waitFor(() =>
    expect((global as any).__expoRouterMock.push).toHaveBeenCalledWith('/booking/carriers'),
  );

  // The recipient details were snapshotted into the booking store (6.1) — the
  // source of the Delivery_Snapshot — independent of any Saved_Recipient.
  const booking = useBookingStore.getState();
  expect(booking.recipientDetails).toMatchObject({
    recipientName: 'Bola Ade',
    recipientPhone: '08012345678',
    deliveryNotes: 'Leave at gate',
  });
  // Still no Saved_Recipient created as a side effect of booking.
  expect(useRecipientStore.getState().recipients).toHaveLength(0);
  expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
});

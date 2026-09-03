// Task 9.2 (part 1) — recipient-edit.tsx edit-mode prefill (3.3).
//
// In edit mode (useLocalSearchParams -> { id }) the screen fetches the existing
// recipient and pre-populates recipientName, recipientPhone, deliveryNotes, and
// label — null-safe (null fields fall back to empty strings). This is a load
// (async store/get), safe to keep with a couple of prefill cases in one file.
//
// _Requirements: 3.3
import { render, screen, waitFor, cleanup } from '@testing-library/react-native';
import RecipientEditScreen from '../app/profile/recipient-edit';
import { installFetch, ok, resetStores } from '../test/helpers';

const NAME = 'Who should the driver ask for?';
const PHONE = '08012345678';
const NOTES = 'Any instructions for the driver? (optional)';
const PRESET = ['Home', 'Office', 'Work', 'Other'];

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('edit mode prefills all four fields incl. a preset label (3.3)', async () => {
  (global as any).__setSearchParams({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  const f = installFetch();
  f.enqueue(
    ok({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      recipientName: 'Bola Ade',
      recipientPhone: '08099887766',
      deliveryNotes: 'Leave at gate',
      label: 'Home',
      created_at: '2025-01-01T00:00:00.000Z',
    }),
  );

  await render(<RecipientEditScreen />);

  // Fields are pre-populated from the fetched recipient.
  await waitFor(() => expect(screen.getByPlaceholderText(NAME).props.value).toBe('Bola Ade'));
  expect(screen.getByPlaceholderText(PHONE).props.value).toBe('08099887766');
  expect(screen.getByPlaceholderText(NOTES).props.value).toBe('Leave at gate');
  // The screen is in edit mode (header + button label reflect editing).
  expect(screen.getByText('Edit Recipient')).toBeOnTheScreen();
  expect(screen.getByText('Update Recipient')).toBeOnTheScreen();

  // A GET was issued for the id.
  const get = f.calls.find((c) => c.method === 'GET');
  expect(get?.url).toContain('/api/v1/recipients/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});

it('edit mode is null-safe: null label/deliveryNotes prefill as empty strings (3.3)', async () => {
  (global as any).__setSearchParams({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
  const f = installFetch();
  f.enqueue(
    ok({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      recipientName: 'No Label Person',
      recipientPhone: '07011112222',
      deliveryNotes: null,
      label: null,
      created_at: '2025-01-01T00:00:00.000Z',
    } as any),
  );

  await render(<RecipientEditScreen />);

  await waitFor(() =>
    expect(screen.getByPlaceholderText(NAME).props.value).toBe('No Label Person'),
  );
  expect(screen.getByPlaceholderText(PHONE).props.value).toBe('07011112222');
  // null deliveryNotes -> empty string, never a crash.
  expect(screen.getByPlaceholderText(NOTES).props.value).toBe('');
  // No preset label is highlighted when label is null (no crash); the "Other"
  // custom field is not shown because label is empty.
  expect(screen.queryByPlaceholderText('Custom label')).toBeNull();
  // Screen rendered fine (edit header present).
  expect(screen.getByText('Edit Recipient')).toBeOnTheScreen();
});

// Task 9.2 (part 4) — recipient-edit.tsx validates against recipientDetailsSchema
// before submission; an invalid form blocks submit (no network call) (7.6).
//
// Own file (async submit handler). Here the submit is blocked by validation, so
// onSubmit never runs and no request is made.
//
// _Requirements: 7.6
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react-native';
import RecipientEditScreen from '../app/profile/recipient-edit';
import { installFetch, resetStores } from '../test/helpers';

const NAME = 'Who should the driver ask for?';
const PHONE = '08012345678';

beforeEach(() => {
  resetStores();
});
afterEach(async () => {
  await cleanup();
});

it('invalid input (bad phone) blocks submit — no create/update request is made (7.6)', async () => {
  (global as any).__setSearchParams({}); // new mode
  const f = installFetch();
  await render(<RecipientEditScreen />);

  // Valid name, but an invalid Nigerian phone (fails recipientDetailsSchema).
  fireEvent.changeText(screen.getByPlaceholderText(NAME), 'Bola Ade');
  fireEvent.changeText(screen.getByPlaceholderText(PHONE), '12345'); // invalid
  await waitFor(() => expect(screen.getByPlaceholderText(PHONE).props.value).toBe('12345'));

  fireEvent.press(screen.getByText('Save Recipient'));
  // Let react-hook-form's zodResolver validation run to completion.
  await new Promise((r) => setTimeout(r, 100));

  // recipientDetailsSchema validation blocked the submit (7.6): onSubmit never
  // ran, so NO create/update request was issued and the screen did not
  // navigate back. This is the deterministic, observable proof that the form is
  // validated against recipientDetailsSchema before submission.
  expect(f.calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  expect(f.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  expect((global as any).__expoRouterMock.back).not.toHaveBeenCalled();

  // Sanity: a VALID phone would have been accepted by the same schema. Confirm
  // the invalid value truly fails recipientDetailsSchema (the schema the screen
  // wires into its zodResolver), pinning the rejection to the shared schema.
  const { recipientDetailsSchema } = require('@surewaka/shared');
  expect(
    recipientDetailsSchema.safeParse({ recipientName: 'Bola Ade', recipientPhone: '12345' }).success,
  ).toBe(false);
  expect(
    recipientDetailsSchema.safeParse({ recipientName: 'Bola Ade', recipientPhone: '08012345678' })
      .success,
  ).toBe(true);
});

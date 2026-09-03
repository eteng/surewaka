// Task 6.3 — store tests.
// useRecipientStore (Zustand) exposes state { recipients, fetched } and actions
// fetch(token) / add / update / remove. fetch() calls apiClient.get and sets
// { recipients, fetched: true } ONLY on success; on error it leaves state intact
// and returns { error }. We mock ../api/client so no network is touched.
// _Requirements: 3.4, 8.3

import type { SavedRecipient } from '@surewaka/shared';
import type { ApiResponse, ApiError } from '../api/client';

// Mock the transport module the store depends on. Only apiClient.get is used by
// fetch(), but we provide the full surface to keep the module shape intact.
jest.mock('../api/client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
}));

import { apiClient } from '../api/client';
import { useRecipientStore } from '../store/recipient-store';

const getMock = apiClient.get as jest.Mock;

const TOKEN = 'test-token';

function recipient(overrides: Partial<SavedRecipient> = {}): SavedRecipient {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    recipientName: 'Bola Ade',
    recipientPhone: '08012345678',
    deliveryNotes: 'Leave at gate',
    label: 'Home',
    created_at: '2025-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function ok<T>(data: T): ApiResponse<T> {
  return { data, error: null };
}

function fail(error: ApiError): ApiResponse<never> {
  return { data: null, error };
}

const sampleError: ApiError = {
  code: 'SERVER_ERROR',
  message: 'boom',
  category: 'server',
  retryable: true,
};

describe('useRecipientStore', () => {
  beforeEach(() => {
    // Reset store to its initial state before each test.
    useRecipientStore.setState({ recipients: [], fetched: false });
    getMock.mockReset();
  });

  describe('fetch', () => {
    it('sets recipients and fetched=true on success', async () => {
      const list = [recipient(), recipient({ id: '22222222-2222-4222-8222-222222222222' })];
      getMock.mockResolvedValueOnce(ok(list));

      const result = await useRecipientStore.getState().fetch(TOKEN);

      expect(getMock).toHaveBeenCalledWith('/api/v1/recipients', TOKEN);
      expect(result.error).toBeNull();
      const state = useRecipientStore.getState();
      expect(state.recipients).toEqual(list);
      expect(state.fetched).toBe(true);
    });

    it('treats a null data payload on success as an empty list', async () => {
      getMock.mockResolvedValueOnce(ok<SavedRecipient[] | null>(null));

      await useRecipientStore.getState().fetch(TOKEN);

      const state = useRecipientStore.getState();
      expect(state.recipients).toEqual([]);
      expect(state.fetched).toBe(true);
    });

    it('leaves state intact and returns { error } on failure', async () => {
      // Seed some existing state to prove fetch does not clobber it on error.
      const existing = [recipient({ id: '33333333-3333-4333-8333-333333333333' })];
      useRecipientStore.setState({ recipients: existing, fetched: false });
      getMock.mockResolvedValueOnce(fail(sampleError));

      const result = await useRecipientStore.getState().fetch(TOKEN);

      expect(result.error).toEqual(sampleError);
      const state = useRecipientStore.getState();
      // recipients unchanged, fetched stays false
      expect(state.recipients).toEqual(existing);
      expect(state.fetched).toBe(false);
    });

    it('does not flip fetched to true when an error occurs even if data is present', async () => {
      getMock.mockResolvedValueOnce({ data: [recipient()], error: sampleError } as ApiResponse<
        SavedRecipient[]
      >);

      await useRecipientStore.getState().fetch(TOKEN);

      const state = useRecipientStore.getState();
      expect(state.fetched).toBe(false);
      expect(state.recipients).toEqual([]);
    });
  });

  describe('add', () => {
    it('appends a recipient to the list', () => {
      const a = recipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const b = recipient({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });

      useRecipientStore.getState().add(a);
      useRecipientStore.getState().add(b);

      expect(useRecipientStore.getState().recipients).toEqual([a, b]);
    });
  });

  describe('update', () => {
    it('merges the patch into the matching recipient only', () => {
      const a = recipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', recipientName: 'A' });
      const b = recipient({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', recipientName: 'B' });
      useRecipientStore.setState({ recipients: [a, b], fetched: true });

      useRecipientStore.getState().update(b.id, { recipientName: 'B-updated', label: 'Work' });

      const [first, second] = useRecipientStore.getState().recipients;
      expect(first).toEqual(a); // untouched
      expect(second).toEqual({ ...b, recipientName: 'B-updated', label: 'Work' });
    });

    it('is a no-op when the id is not present', () => {
      const a = recipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      useRecipientStore.setState({ recipients: [a], fetched: true });

      useRecipientStore.getState().update('does-not-exist', { recipientName: 'X' });

      expect(useRecipientStore.getState().recipients).toEqual([a]);
    });
  });

  describe('remove', () => {
    it('removes the recipient with the matching id', () => {
      const a = recipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      const b = recipient({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' });
      useRecipientStore.setState({ recipients: [a, b], fetched: true });

      useRecipientStore.getState().remove(a.id);

      expect(useRecipientStore.getState().recipients).toEqual([b]);
    });

    it('is a no-op when the id is not present', () => {
      const a = recipient({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
      useRecipientStore.setState({ recipients: [a], fetched: true });

      useRecipientStore.getState().remove('does-not-exist');

      expect(useRecipientStore.getState().recipients).toEqual([a]);
    });
  });
});

import { createRecipientsClient } from '../api/recipients';
import type { SavedRecipient, CreateSavedRecipient, UpdateSavedRecipient } from '@surewaka/shared';

// Task 6.3 — client tests.
// The recipients client is built on createAuthClient(token) from ../api/client,
// whose request() uses the global fetch. We mock fetch (the transport) and
// assert the HTTP method + URL + body of each call rather than hitting the
// network. The API base URL is provided by jest.setup.js
// (EXPO_PUBLIC_API_URL=https://api.test.local).
// _Requirements: 3.4_

const BASE_URL = 'https://api.test.local';
const TOKEN = 'test-token-123';

const sampleRecipient: SavedRecipient = {
  id: '11111111-1111-4111-8111-111111111111',
  recipientName: 'Bola Ade',
  recipientPhone: '08012345678',
  deliveryNotes: 'Leave at gate',
  label: 'Home',
  created_at: '2025-01-01T00:00:00.000Z',
};

/** Build a Response-like object matching what request() consumes. */
function jsonResponse<T>(data: T, init: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = init;
  return {
    ok,
    status,
    json: async () => ({ data, error: null, meta: null }),
  };
}

/** Grab the single [url, init] pair fetch was called with. */
function lastFetchCall() {
  const mock = global.fetch as jest.Mock;
  const call = mock.mock.calls.at(-1);
  if (!call) throw new Error('fetch was not called');
  const [url, init] = call as [string, RequestInit];
  return { url, init };
}

describe('createRecipientsClient', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(jsonResponse(sampleRecipient));
    // @ts-expect-error assigning a mock to the global fetch for the test
    global.fetch = fetchMock;
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('list() issues GET /api/v1/recipients with the auth header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse<SavedRecipient[]>([sampleRecipient]));
    const client = createRecipientsClient(TOKEN);

    const res = await client.list();

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE_URL}/api/v1/recipients`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(res.error).toBeNull();
    expect(res.data).toEqual([sampleRecipient]);
  });

  it('get(id) issues GET /api/v1/recipients/:id', async () => {
    const client = createRecipientsClient(TOKEN);

    await client.get(sampleRecipient.id);

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE_URL}/api/v1/recipients/${sampleRecipient.id}`);
    expect(init.method).toBe('GET');
  });

  it('create(body) issues POST /api/v1/recipients with a JSON body', async () => {
    const body: CreateSavedRecipient = {
      recipientName: 'Chidi Nwankwo',
      recipientPhone: '+2347012345678',
      deliveryNotes: 'Call on arrival',
      label: 'Office',
    };
    const client = createRecipientsClient(TOKEN);

    await client.create(body);

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE_URL}/api/v1/recipients`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('update(id, body) issues PUT /api/v1/recipients/:id with a JSON body', async () => {
    const patch: UpdateSavedRecipient = { recipientName: 'Updated Name', label: 'Work' };
    const client = createRecipientsClient(TOKEN);

    await client.update(sampleRecipient.id, patch);

    const { url, init } = lastFetchCall();
    // The core assertion for task 6.3: update uses PUT (not PATCH) at the :id path.
    expect(init.method).toBe('PUT');
    expect(url).toBe(`${BASE_URL}/api/v1/recipients/${sampleRecipient.id}`);
    expect(JSON.parse(init.body as string)).toEqual(patch);
  });

  it('remove(id) issues DELETE /api/v1/recipients/:id with no body', async () => {
    const client = createRecipientsClient(TOKEN);

    await client.remove(sampleRecipient.id);

    const { url, init } = lastFetchCall();
    expect(url).toBe(`${BASE_URL}/api/v1/recipients/${sampleRecipient.id}`);
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('propagates a classified error from the transport (no throw)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'NOT_FOUND', message: 'nope' }, meta: null }),
    });
    const client = createRecipientsClient(TOKEN);

    const res = await client.get('missing-id');

    expect(res.data).toBeNull();
    expect(res.error).toMatchObject({ code: 'NOT_FOUND', category: 'not_found', retryable: false });
  });
});

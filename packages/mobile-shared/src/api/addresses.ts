import { createAuthClient } from './client';
import type { SavedAddress, CreateSavedAddress, UpdateSavedAddress, RecentLocation, UpsertRecentLocation } from '@surewaka/shared';

export function createAddressesClient(token: string) {
  const client = createAuthClient(token);
  return {
    list:         ()                                        => client.get<SavedAddress[]>('/api/v1/addresses'),
    get:          (id: string)                              => client.get<SavedAddress>(`/api/v1/addresses/${id}`),
    create:       (body: CreateSavedAddress)                => client.post<SavedAddress>('/api/v1/addresses', body),
    update:       (id: string, body: UpdateSavedAddress)    => client.put<SavedAddress>(`/api/v1/addresses/${id}`, body),
    remove:       (id: string)                              => client.delete<void>(`/api/v1/addresses/${id}`),
    listRecent:   ()                                        => client.get<RecentLocation[]>('/api/v1/addresses/recent'),
    upsertRecent: (body: UpsertRecentLocation)              => client.post<void>('/api/v1/addresses/recent', body),
  };
}

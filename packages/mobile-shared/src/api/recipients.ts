import { createAuthClient } from './client';
import type { SavedRecipient, CreateSavedRecipient, UpdateSavedRecipient } from '@surewaka/shared';

export function createRecipientsClient(token: string) {
  const client = createAuthClient(token);
  return {
    list:   ()                                       => client.get<SavedRecipient[]>('/api/v1/recipients'),
    get:    (id: string)                             => client.get<SavedRecipient>(`/api/v1/recipients/${id}`),
    create: (body: CreateSavedRecipient)             => client.post<SavedRecipient>('/api/v1/recipients', body),
    update: (id: string, body: UpdateSavedRecipient) => client.put<SavedRecipient>(`/api/v1/recipients/${id}`, body),
    remove: (id: string)                             => client.delete<void>(`/api/v1/recipients/${id}`),
  };
}

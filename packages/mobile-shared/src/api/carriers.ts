import { apiClient } from './client';
import type { Carrier } from '@surewaka/shared';

export const carriersApi = {
  list: () => apiClient.get<Carrier[]>('/api/v1/carriers'),
};

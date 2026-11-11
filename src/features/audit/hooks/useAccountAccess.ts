'use client';

import { useAsyncData, type AsyncData } from '@/hooks/useAsyncData';
import { fetchAccountAccess } from '../services/client';
import type { AccountAccessResponse } from '../types';

/** アカウントの棚卸しの一覧（アカウントと、受け取られていない招待） */
export const useAccountAccess = (): AsyncData<AccountAccessResponse> => useAsyncData(fetchAccountAccess);

'use client';

import { fetchSnapshot } from '@/lib/resources/client';
import type { EquitySnapshot } from '@/lib/equity/types';
import { useAsyncData, type AsyncData } from './useAsyncData';

/** 株式・新株予約権の台帳一式を読む（資本政策表・株主名簿・ストックオプションの画面で使う） */
export const useEquitySnapshot = (): AsyncData<EquitySnapshot> => useAsyncData(fetchSnapshot);

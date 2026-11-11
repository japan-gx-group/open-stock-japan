'use client';

import { useMemo } from 'react';
import type { Governance } from '@/lib/legal/rules';
import { fetchCompany } from '@/lib/resources/client';
import { governanceOf } from '@/lib/resources/company';
import type { ResourceRow } from '@/lib/resources/fields';
import { useAsyncData, type AsyncData } from './useAsyncData';

/** 会社情報と、そこから取り出した機関設計（法令の計算に使う） */
export const useCompany = (): AsyncData<ResourceRow> & { governance: Governance } => {
  const state = useAsyncData(fetchCompany);
  const governance = useMemo(() => governanceOf(state.data), [state.data]);
  return { ...state, governance };
};

'use client';

import { useCallback } from 'react';
import { listItems } from '@/lib/resources/client';
import type { ResourceName } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';
import { useAsyncData, type AsyncData } from './useAsyncData';

/** 業務データの一覧を読む。filterKey / filterValue は絞り込み（例: 'meetingId', id） */
export const useResourceList = <T extends ResourceRow = ResourceRow>(
  resource: ResourceName,
  filterKey?: string,
  filterValue?: string | null,
): AsyncData<T[]> => {
  const load = useCallback(
    () => listItems<T>(resource, filterKey && filterValue ? { [filterKey]: filterValue } : {}),
    [resource, filterKey, filterValue],
  );
  return useAsyncData(load);
};

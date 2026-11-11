'use client';

import { useCallback } from 'react';
import { useAsyncData, type AsyncData } from '@/hooks/useAsyncData';
import { apiFetch } from '@/lib/resources/client';
import type { LibraryDocument } from '../services/documents';

/** 文書の一覧を読む。entityType / entityId を渡すと、そのレコードに付いた文書だけ */
export const useDocuments = (entityType?: string, entityId?: string | null): AsyncData<LibraryDocument[]> => {
  const load = useCallback(async () => {
    // 関連づけで絞る指定なのに id がまだ無いときは、全件を読まずに空を返す
    if (entityType && !entityId) return [];
    const query = entityType && entityId ? `?${new URLSearchParams({ entityType, entityId }).toString()}` : '';
    const { items } = await apiFetch<{ items: LibraryDocument[] }>(`/api/documents${query}`);
    return items.map((item) => ({ ...item, sizeBytes: Number(item.sizeBytes) }));
  }, [entityType, entityId]);
  return useAsyncData(load);
};

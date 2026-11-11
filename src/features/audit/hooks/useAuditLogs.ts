'use client';

// 監査ログの一覧（絞り込み・続きの読み込み）の状態。
// 条件が変わったら最初のページから読み直す。読み直しのあいだは前の結果を出したままにし、isRefreshing で知らせる。

import { useCallback, useMemo, useState } from 'react';
import { useAsyncData } from '@/hooks/useAsyncData';
import { errorMessage } from '@/lib/resources/client';
import { fetchAuditLogPage } from '../services/client';
import { toQueryString, type AuditLogFilters } from '../services/filters';
import type { AuditLogItem, AuditLogPage } from '../types';

interface FirstPage {
  /** この結果を読んだときの条件（toQueryString の文字） */
  key: string;
  page: AuditLogPage;
}

interface MorePages {
  /** どの最初のページの続きか（読み直したら、続きは捨てる） */
  base: FirstPage;
  items: AuditLogItem[];
  nextCursor: string | null;
}

export interface AuditLogsState {
  items: AuditLogItem[];
  /** 条件に合う記録の件数。まだ分からなければ null */
  total: number | null;
  hasMore: boolean;
  /** 最初の読み込み中（まだ何も出せない） */
  isLoading: boolean;
  /** 条件を変えたあとの読み直し中（前の結果を出している） */
  isRefreshing: boolean;
  isLoadingMore: boolean;
  error: string | null;
  loadMoreError: string | null;
  loadMore: () => Promise<void>;
  reload: () => Promise<void>;
}

export const useAuditLogs = (filters: AuditLogFilters): AuditLogsState => {
  const key = useMemo(() => toQueryString(filters), [filters]);
  // 条件の中身が同じなら読み直さない（filters のオブジェクトが作り直されても、key は変わらない）
  const load = useCallback(async (): Promise<FirstPage> => ({ key, page: await fetchAuditLogPage(key, null) }), [key]);
  const first = useAsyncData(load);
  const [more, setMore] = useState<MorePages | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  const base = first.data;
  const isCurrent = base != null && base.key === key;
  const extra = more && more.base === base ? more : null;
  const nextCursor = base ? (extra ? extra.nextCursor : base.page.nextCursor) : null;

  const items = useMemo(() => (base ? [...base.page.items, ...(extra?.items ?? [])] : []), [base, extra]);

  const loadMore = useCallback(async () => {
    if (!base || !nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setLoadMoreError(null);
    try {
      const page = await fetchAuditLogPage(base.key, nextCursor);
      setMore((previous) => ({
        base,
        items: [...(previous && previous.base === base ? previous.items : []), ...page.items],
        nextCursor: page.nextCursor,
      }));
    } catch (caught) {
      setLoadMoreError(errorMessage(caught, '続きの読み込みに失敗しました'));
    } finally {
      setIsLoadingMore(false);
    }
  }, [base, nextCursor, isLoadingMore]);

  // 条件を変えたあとの読み込みが失敗したら、前の条件の結果は出さない（いまの条件の結果に見えてしまうため）
  const failedForCurrent = first.error != null && !isCurrent;

  return {
    items: failedForCurrent ? [] : items,
    total: isCurrent ? (base.page.total ?? null) : null,
    hasMore: isCurrent && nextCursor != null,
    isLoading: first.isLoading && !base,
    isRefreshing: base != null && !isCurrent && first.error == null,
    isLoadingMore,
    error: first.error,
    loadMoreError: isCurrent ? loadMoreError : null,
    loadMore,
    reload: first.reload,
  };
};

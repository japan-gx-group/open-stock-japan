'use client';

// 株主ポータルの利用状況（権利者ごと）を読む hook。
//
// 状況の一覧は画面全体で 1 回だけ読み、モジュール内に持つ。表の各行の PortalAccessControl がそれぞれこの hook を
// 呼んでも、リクエストは 1 本にまとまる（行数ぶんのリクエストにならない）。
// 招待・取り消しのあとは reload() で読み直すと、同じ画面のすべての行に反映される。

import { useEffect, useSyncExternalStore } from 'react';
import { apiFetch, errorMessage } from '@/lib/resources/client';
import type { PortalAccessEntry, PortalAccessMap } from '../services/status';

interface State {
  map: PortalAccessMap | null;
  error: string | null;
  isLoading: boolean;
}

let state: State = { map: null, error: null, isLoading: false };
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

const setState = (next: State) => {
  state = next;
  listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => state;
const SERVER_STATE: State = { map: null, error: null, isLoading: true };
const getServerSnapshot = () => SERVER_STATE;

const load = (): Promise<void> => {
  if (inflight) return inflight;
  setState({ ...state, isLoading: true });
  inflight = apiFetch<{ items: PortalAccessMap }>('/api/portal-access')
    .then(({ items }) => setState({ map: items, error: null, isLoading: false }))
    .catch((error: unknown) => setState({ map: state.map, error: errorMessage(error, '利用状況の取得に失敗しました'), isLoading: false }))
    .finally(() => {
      inflight = null;
    });
  return inflight;
};

/** 別のアカウントでログインし直したときなどに、持っている状況を捨てる */
export const resetPortalAccessCache = (): void => {
  inflight = null;
  setState({ map: null, error: null, isLoading: false });
};

export interface UsePortalAccess {
  /** 権利者の id → 利用状況。読み込み前は null */
  map: PortalAccessMap | null;
  error: string | null;
  isLoading: boolean;
  /** 1 人分の状況（読み込み前・一覧に無い id は null） */
  statusOf: (stakeholderId: string) => PortalAccessEntry | null;
  /** 読み直す（招待・取り消しのあと） */
  reload: () => Promise<void>;
}

export const usePortalAccess = (): UsePortalAccess => {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    // 最初に使われたときに 1 回だけ読む（読み込み中・読み込み済み・失敗済みなら何もしない）
    if (state.map == null && state.error == null && !inflight) void load();
  }, []);
  return {
    map: current.map,
    error: current.error,
    isLoading: current.isLoading || (current.map == null && current.error == null),
    statusOf: (stakeholderId) => current.map?.[stakeholderId] ?? null,
    reload: load,
  };
};

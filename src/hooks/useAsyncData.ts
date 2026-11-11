'use client';

// API から読むデータの共通の状態（読み込み中・エラー・再読み込み）。
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/resources/client';

export interface AsyncData<T> {
  data: T | null;
  error: string | null;
  isLoading: boolean;
  /** 読み直す（保存・削除のあとに呼ぶ） */
  reload: () => Promise<void>;
}

/** load は useCallback で固定した関数を渡す（変わるたびに読み直す） */
export const useAsyncData = <T,>(load: () => Promise<T>): AsyncData<T> => {
  const [state, setState] = useState<{ data: T | null; error: string | null; isLoading: boolean }>({
    data: null,
    error: null,
    isLoading: true,
  });
  // 古い要求の結果が、新しい要求の結果を上書きしないようにする
  const requestId = useRef(0);

  const run = useCallback(async () => {
    const id = (requestId.current += 1);
    try {
      const data = await load();
      if (id === requestId.current) setState({ data, error: null, isLoading: false });
    } catch (error) {
      if (id === requestId.current) {
        setState((previous) => ({ data: previous.data, error: errorMessage(error, 'データの取得に失敗しました'), isLoading: false }));
      }
    }
  }, [load]);

  useEffect(() => {
    void run();
  }, [run]);

  return { ...state, reload: run };
};

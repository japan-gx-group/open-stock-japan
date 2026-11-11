'use client';

// 確認画面の状態（行の値・参照・対象）と、その検証の結果。
// 検証は画面でも行うが、反映のときにサーバが今の台帳でやり直す（画面の結果は目安）。

import { useCallback, useMemo, useState } from 'react';
import { checkReview } from '@/lib/import/review';
import type { ExtractionResponse, GroupKey, NamedRow, ReviewCheck, ReviewState } from '@/lib/import/types';
import {
  setCompanyFieldTicked,
  setGroupIncluded,
  setGroupValue,
  setRowIncluded,
  setRowRef,
  setRowValue,
  linkToExistingRow,
} from '../services/reviewEdits';

export interface ReviewActions {
  setValue: (group: GroupKey, key: string, field: string, value: string | boolean) => void;
  setRef: (group: GroupKey, key: string, ref: string, value: string) => void;
  setIncluded: (group: GroupKey, key: string, include: boolean) => void;
  setAllIncluded: (group: GroupKey, include: boolean) => void;
  linkExisting: (group: GroupKey, key: string, existing: NamedRow) => void;
  setTicked: (key: string, field: string, ticked: boolean) => void;
  setAllValues: (group: GroupKey, field: string, value: string) => void;
}

export const useImportReview = (data: ExtractionResponse): { state: ReviewState; check: ReviewCheck; actions: ReviewActions } => {
  const [state, setState] = useState<ReviewState>(data.review);
  const kind = data.extraction.documentKind;
  const check = useMemo(() => checkReview(kind, state, data.context), [kind, state, data.context]);

  const setValue = useCallback<ReviewActions['setValue']>((group, key, field, value) => setState((current) => setRowValue(current, group, key, field, value)), []);
  const setRef = useCallback<ReviewActions['setRef']>((group, key, ref, value) => setState((current) => setRowRef(current, group, key, ref, value)), []);
  const setIncluded = useCallback<ReviewActions['setIncluded']>((group, key, include) => setState((current) => setRowIncluded(current, group, key, include)), []);
  const setAllIncluded = useCallback<ReviewActions['setAllIncluded']>((group, include) => setState((current) => setGroupIncluded(current, group, include)), []);
  const linkExisting = useCallback<ReviewActions['linkExisting']>((group, key, existing) => setState((current) => linkToExistingRow(current, group, key, existing)), []);
  const setTicked = useCallback<ReviewActions['setTicked']>((key, field, ticked) => setState((current) => setCompanyFieldTicked(current, key, field, ticked)), []);
  const setAllValues = useCallback<ReviewActions['setAllValues']>((group, field, value) => setState((current) => setGroupValue(current, group, field, value)), []);

  const actions = useMemo(
    () => ({ setValue, setRef, setIncluded, setAllIncluded, linkExisting, setTicked, setAllValues }),
    [setValue, setRef, setIncluded, setAllIncluded, linkExisting, setTicked, setAllValues],
  );
  return { state, check, actions };
};

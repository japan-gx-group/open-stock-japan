// 画面から監査ログの API を呼ぶ関数（ブラウザ用）。

import { downloadBlob } from '@/lib/files/download';
import { ApiError, apiFetch } from '@/lib/resources/client';
import type { AccountAccessResponse, AuditLogDetail, AuditLogPage, VerifyResponse } from '../types';
import { toQueryString, type AuditLogFilters } from './filters';

/** 一覧の 1 ページ。filterQuery は toQueryString で作った条件の文字（条件が同じなら同じ文字になる） */
export const fetchAuditLogPage = (filterQuery: string, cursor: string | null): Promise<AuditLogPage> => {
  const params = new URLSearchParams(filterQuery);
  if (cursor) params.set('cursor', cursor);
  return apiFetch<AuditLogPage>(`/api/audit/logs?${params.toString()}`);
};

export const fetchAuditLogDetail = async (id: string): Promise<AuditLogDetail> =>
  (await apiFetch<{ item: AuditLogDetail }>(`/api/audit/logs/${encodeURIComponent(id)}`)).item;

export const fetchAccountAccess = (): Promise<AccountAccessResponse> => apiFetch<AccountAccessResponse>('/api/audit/accounts');

export const requestChainVerify = (anchor?: { anchorSeq: string; anchorHash: string }): Promise<VerifyResponse> =>
  apiFetch<VerifyResponse>('/api/audit/verify', { method: 'POST', body: JSON.stringify(anchor ?? {}) });

export interface CsvDownloadResult {
  fileName: string;
  /** 出力した行数・条件に合う件数・上限（応答のヘッダから。無ければ null） */
  rowCount: number | null;
  totalCount: number | null;
  maxRows: number | null;
  /** 上限で打ち切られたか */
  truncated: boolean;
}

const numberHeader = (response: Response, name: string): number | null => {
  const value = response.headers.get(name);
  return value != null && /^\d+$/.test(value) ? Number(value) : null;
};

/** CSV を受け取って保存させる。失敗は ApiError（message は利用者向けの文） */
const downloadCsv = async (url: string, fallbackName: string): Promise<CsvDownloadResult> => {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store' });
  } catch {
    throw new ApiError('通信に失敗しました。時間をおいて再度お試しください', 0);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(body?.error ?? 'CSV の出力に失敗しました', response.status);
  }
  const fileName = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? fallbackName;
  downloadBlob(await response.blob(), fileName);
  return {
    fileName,
    rowCount: numberHeader(response, 'x-audit-row-count'),
    totalCount: numberHeader(response, 'x-audit-total-count'),
    maxRows: numberHeader(response, 'x-audit-max-rows'),
    truncated: response.headers.get('x-audit-truncated') === 'true',
  };
};

export const downloadAuditLogCsv = (filters: AuditLogFilters): Promise<CsvDownloadResult> =>
  downloadCsv(`/api/audit/logs/export?${toQueryString(filters)}`, 'audit-log.csv');

export const downloadAccountAccessCsv = (): Promise<CsvDownloadResult> => downloadCsv('/api/audit/accounts/export', 'access-review.csv');

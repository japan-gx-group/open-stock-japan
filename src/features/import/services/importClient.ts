// AI 取り込みの API を画面から呼ぶ関数（ブラウザ用）。

import { ApiError, apiFetch } from '@/lib/resources/client';
import { toApplyPayload } from '@/lib/import/applyPlan';
import type { ExtractionResponse, ExtractionSummaryRow, ImportDocumentKind, ReviewState, RowIssues } from '@/lib/import/types';

export type KindChoice = ImportDocumentKind | 'auto';

/** 読取りの失敗。文書が保存済みなら storedDocument が入る（もう一度読み取れる） */
export class ExtractError extends Error {
  readonly code: string | null;
  readonly storedDocument: { id: string; title: string; fileName: string } | null;

  constructor(message: string, code: string | null, storedDocument: { id: string; title: string; fileName: string } | null) {
    super(message);
    this.name = 'ExtractError';
    this.code = code;
    this.storedDocument = storedDocument;
  }
}

/** 反映の失敗。行ごとの問題（サーバが今の台帳で調べ直した結果）が入ることがある */
export class ApplyError extends Error {
  readonly rowIssues: Record<string, RowIssues> | null;

  constructor(message: string, rowIssues: Record<string, RowIssues> | null) {
    super(message);
    this.name = 'ApplyError';
    this.rowIssues = rowIssues;
  }
}

interface FailureBody {
  error?: string;
  code?: string | null;
  document?: { id: string; title: string; fileName: string };
  rowIssues?: Record<string, RowIssues>;
}

const postExtract = async (url: string, init: RequestInit): Promise<ExtractionResponse> => {
  let response: Response;
  try {
    response = await fetch(url, { cache: 'no-store', ...init });
  } catch {
    throw new ExtractError('通信に失敗しました。時間をおいて再度お試しください', null, null);
  }
  const body = (await response.json().catch(() => null)) as (ExtractionResponse & FailureBody) | null;
  if (!response.ok || !body?.extraction) {
    throw new ExtractError(body?.error ?? 'AI による読取りに失敗しました', body?.code ?? null, body?.document ?? null);
  }
  return body;
};

export const extractDocument = (file: File, documentKind: KindChoice, title: string): Promise<ExtractionResponse> => {
  const form = new FormData();
  form.set('file', file);
  form.set('documentKind', documentKind);
  if (title.trim()) form.set('title', title.trim());
  return postExtract('/api/import/extract', { method: 'POST', body: form });
};

/** 保存済みの文書を、もう一度読み取る */
export const retryExtraction = (documentId: string, documentKind: KindChoice): Promise<ExtractionResponse> =>
  postExtract(`/api/import/${documentId}/retry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentKind }),
  });

export const fetchExtractions = async (): Promise<ExtractionSummaryRow[]> =>
  (await apiFetch<{ items: ExtractionSummaryRow[] }>('/api/import')).items;

export const fetchExtraction = (id: string): Promise<ExtractionResponse> => apiFetch<ExtractionResponse>(`/api/import/${id}`);

export const applyExtraction = async (id: string, state: ReviewState): Promise<ExtractionResponse> => {
  let response: Response;
  try {
    response = await fetch(`/api/import/${id}/apply`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApplyPayload(state)),
    });
  } catch {
    throw new ApplyError('通信に失敗しました。時間をおいて再度お試しください', null);
  }
  const body = (await response.json().catch(() => null)) as (ExtractionResponse & FailureBody) | null;
  if (!response.ok || !body?.extraction) throw new ApplyError(body?.error ?? '台帳への反映に失敗しました', body?.rowIssues ?? null);
  return body;
};

export const discardExtraction = async (id: string): Promise<void> => {
  await apiFetch(`/api/import/${id}/discard`, { method: 'POST' });
};

export { ApiError };

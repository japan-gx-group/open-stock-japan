// 画面から業務データの API を呼ぶ関数（ブラウザ用）。
import type { EquitySnapshot } from '@/lib/equity/types';
import type { ResourceName } from './definitions';
import type { ResourceRow } from './fields';

export class ApiError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;
  readonly code: string | null;

  constructor(message: string, status: number, fieldErrors: Record<string, string> = {}, code: string | null = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

/** JSON を返す API を呼ぶ。失敗は ApiError（message は利用者向けの文） */
export const apiFetch = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
  let response: Response;
  try {
    const isForm = init.body instanceof FormData;
    response = await fetch(url, {
      cache: 'no-store',
      ...init,
      headers: { ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError('通信に失敗しました。時間をおいて再度お試しください', 0);
  }
  const body = (await response.json().catch(() => null)) as
    | { error?: string; fieldErrors?: Record<string, string>; code?: string }
    | null;
  if (!response.ok) {
    throw new ApiError(body?.error ?? '処理に失敗しました', response.status, body?.fieldErrors ?? {}, body?.code ?? null);
  }
  return body as T;
};

export const errorMessage = (error: unknown, fallback = '処理に失敗しました'): string =>
  error instanceof Error && error.message ? error.message : fallback;

export const listItems = async <T extends ResourceRow = ResourceRow>(
  resource: ResourceName,
  filters: Record<string, string> = {},
): Promise<T[]> => {
  const query = new URLSearchParams(filters).toString();
  const { items } = await apiFetch<{ items: T[] }>(`/api/resources/${resource}${query ? `?${query}` : ''}`);
  return items;
};

/** id があれば更新、無ければ登録 */
export const saveItem = async <T extends ResourceRow = ResourceRow>(
  resource: ResourceName,
  values: Record<string, unknown>,
  id?: string | null,
): Promise<T> => {
  const { item } = await apiFetch<{ item: T }>(id ? `/api/resources/${resource}/${id}` : `/api/resources/${resource}`, {
    method: id ? 'PATCH' : 'POST',
    body: JSON.stringify(values),
  });
  return item;
};

export const deleteItem = async (resource: ResourceName, id: string): Promise<void> => {
  await apiFetch(`/api/resources/${resource}/${id}`, { method: 'DELETE' });
};

export const fetchSnapshot = async (): Promise<EquitySnapshot> =>
  (await apiFetch<{ snapshot: EquitySnapshot }>('/api/equity')).snapshot;

export const fetchCompany = async (): Promise<ResourceRow> =>
  (await apiFetch<{ company: ResourceRow }>('/api/company')).company;

export const saveCompany = async (values: Record<string, unknown>): Promise<ResourceRow> =>
  (await apiFetch<{ company: ResourceRow }>('/api/company', { method: 'PATCH', body: JSON.stringify(values) })).company;

export interface DraftResult {
  body: string;
  notes: string[];
}

export const requestDraft = async (kind: string, context: string, request = ''): Promise<DraftResult> =>
  apiFetch<DraftResult>('/api/ai/draft', { method: 'POST', body: JSON.stringify({ kind, context, request }) });

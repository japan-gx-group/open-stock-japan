// 文書テンプレートの API を呼ぶ関数（ブラウザ用）。テンプレートそのものの保存・削除は、汎用の
// /api/resources/document-templates（src/lib/resources/client.ts の saveItem / deleteItem）を使う。

import { apiFetch } from '@/lib/resources/client';
import type { TemplateKindId } from '@/lib/resources/definitions';
import type { AiProviderId } from '@/types/ai';
import type { AppliedReplacement, SkippedReplacement } from './convert';

export interface WrittenTemplateResult {
  title: string;
  body: string;
  notes: string[];
  provider: AiProviderId;
  modelId: string;
}

/** AI に、種類ごとのひな形を書かせる */
export const requestTemplateDraft = (kind: TemplateKindId, request: string, reference: string): Promise<WrittenTemplateResult> =>
  apiFetch<WrittenTemplateResult>('/api/ai/template', {
    method: 'POST',
    body: JSON.stringify({ mode: 'write', kind, request, reference }),
  });

export interface ConvertedTemplateResult {
  body: string;
  applied: AppliedReplacement[];
  skipped: SkippedReplacement[];
  remainingBlanks: number;
  notes: string[];
  provider: AiProviderId;
  modelId: string;
}

/** 貼り付けた文面の空欄を、差し込み項目に置き換える（AI は場所の案を出すだけ） */
export const requestTemplateConversion = (kind: TemplateKindId, source: string): Promise<ConvertedTemplateResult> =>
  apiFetch<ConvertedTemplateResult>('/api/ai/template', {
    method: 'POST',
    body: JSON.stringify({ mode: 'convert', kind, source }),
  });

export interface ComposedDocument {
  title: string;
  text: string;
  missing: string[];
  unknown: string[];
  warnings: string[];
  templateStatus: string;
}

/** テンプレートの差し込み項目を、台帳の値に置き換えた文書を作る */
export const composeDocument = async (
  templateId: string,
  subjectId: string | null,
  investmentId: string | null,
): Promise<ComposedDocument> =>
  (
    await apiFetch<{ document: ComposedDocument }>('/api/templates/compose', {
      method: 'POST',
      body: JSON.stringify({ templateId, subjectId, investmentId }),
    })
  ).document;

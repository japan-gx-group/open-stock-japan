// 文書テンプレートの行の型。列はリソース定義（src/lib/resources/definitions.ts の document-templates）のとおり。

import type { TemplateKindId } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';

export type TemplateStatus = 'draft' | 'reviewed';

export type TemplateRow = ResourceRow & {
  title: string;
  kind: TemplateKindId;
  status: TemplateStatus;
  body: string;
  notes: string;
};

/** 編集の画面に渡す、保存前のテンプレート（新規は id が無い） */
export interface TemplateDraft {
  id: string | null;
  kind: TemplateKindId;
  title: string;
  body: string;
  notes: string;
  status: TemplateStatus;
  /** 作った直後に編集の画面の上に出す知らせ（AI が書いた・空欄をいくつ置き換えた、など） */
  origin?: { summary: string; details: string[] } | null;
}

// お知らせの下書きの材料と、株主の連絡先の一覧。サーバ依存なし。

import { buildRegistry } from '@/lib/equity/ledger';
import type { EquitySnapshot } from '@/lib/equity/types';
import { optionLabel } from '@/lib/equity/types';
import { UPDATE_CATEGORIES } from '@/lib/resources/definitions';

/** AI にお知らせの下書きを作らせるときの材料（利用者のメモ ＋ 任意で決算の数字） */
export const buildUpdateDraftContext = (input: {
  companyName?: string | null;
  title: string;
  category: string;
  memo: string;
  /** 公開済みの最新の決算の数字（含めるときだけ渡す） */
  figuresSummary?: string | null;
  today?: string;
}): string => {
  const lines = [
    ...(input.companyName ? [`会社名: ${input.companyName}`] : []),
    `お知らせの種類: ${optionLabel(UPDATE_CATEGORIES, input.category)}`,
    `タイトル: ${input.title}`,
    ...(input.today ? [`作成日: ${input.today}`] : []),
    '',
    '【伝えたいこと（担当者のメモ）】',
    input.memo.trim() || '（メモなし）',
  ];
  if (input.figuresSummary?.trim()) {
    lines.push('', '【株主に公開済みの最新の決算】', input.figuresSummary.trim(), '金額は円。マイナスは損失。');
  }
  return lines.join('\n');
};

export interface ShareholderContacts {
  /** 現在株式を持っている株主のメールアドレス（重複なし） */
  emails: string[];
  /** 現在株式を持っているが、メールアドレスが未登録の株主の氏名・名称 */
  missing: string[];
  shareholderCount: number;
}

/** 現在株式を持っている株主の連絡先。新株予約権・転換型だけの権利者は含めない */
export const shareholderContacts = (snapshot: EquitySnapshot): ShareholderContacts => {
  const holderIds = new Set(buildRegistry(snapshot).rows.map((row) => row.stakeholderId));
  const emails = new Set<string>();
  const missing: string[] = [];
  for (const stakeholder of snapshot.stakeholders) {
    if (!holderIds.has(stakeholder.id)) continue;
    const email = stakeholder.email?.trim().toLowerCase();
    if (email) emails.add(email);
    else missing.push(stakeholder.name);
  }
  return { emails: Array.from(emails), missing, shareholderCount: holderIds.size };
};

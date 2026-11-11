// 文書ライブラリの絞り込みと表示のための関数。サーバ依存なし。

import type { ShareLinkStatus } from '@/lib/sharing/linkRules';

/** 画面で扱う文書の行（GET /api/documents の items） */
export interface LibraryDocument {
  id: string;
  title: string;
  category: string;
  description: string;
  documentDate: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  visibility: 'internal' | 'shareholders' | 'restricted';
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentFilters {
  category: string;
  visibility: string;
  search: string;
}

const normalize = (value: string): string => value.normalize('NFKC').toLowerCase();

/** 分類・公開範囲・キーワード（タイトル・ファイル名・説明。空白区切りはすべて含むもの）で絞る */
export const filterDocuments = <T extends Pick<LibraryDocument, 'title' | 'fileName' | 'description' | 'category' | 'visibility'>>(
  documents: readonly T[],
  filters: DocumentFilters,
): T[] => {
  const words = normalize(filters.search).split(/\s+/).filter(Boolean);
  return documents.filter((document) => {
    if (filters.category && document.category !== filters.category) return false;
    if (filters.visibility && document.visibility !== filters.visibility) return false;
    if (words.length === 0) return true;
    const haystack = normalize(`${document.title} ${document.fileName} ${document.description}`);
    return words.every((word) => haystack.includes(word));
  });
};

export const VISIBILITY_TONES: Record<LibraryDocument['visibility'], string> = {
  internal: 'gt-pill-neutral',
  shareholders: 'gt-pill-good',
  restricted: 'gt-pill-info',
};

/** 関連するレコードの種類ごとの表示名と、開く画面 */
export const ENTITY_TYPES: Record<string, { label: string; path: string }> = {
  meeting: { label: '会議', path: '/shareholder-meetings' },
  financial_report: { label: '決算情報', path: '/financials' },
  shareholder_update: { label: 'お知らせ', path: '/updates' },
  funding_round: { label: '資金調達', path: '/rounds' },
  option_plan: { label: 'ストックオプション', path: '/stock-options' },
  convertible_round: { label: 'J-KISS・転換型', path: '/convertibles' },
  stakeholder: { label: '株主', path: '/shareholders' },
};

export interface EntityTitles {
  meetings: ReadonlyMap<string, { title: string; meetingType: string }>;
  financialReports: ReadonlyMap<string, string>;
  updates: ReadonlyMap<string, string>;
}

/** 文書に関連づけられたレコードの表示（「決算情報: 第3期 決算」）と、開く画面。関連が無ければ null */
export const describeEntity = (
  document: Pick<LibraryDocument, 'entityType' | 'entityId'>,
  titles: EntityTitles,
): { label: string; path: string } | null => {
  if (!document.entityType || !document.entityId) return null;
  const type = ENTITY_TYPES[document.entityType];
  if (!type) return null;
  if (document.entityType === 'meeting') {
    const meeting = titles.meetings.get(document.entityId);
    const isBoard = meeting?.meetingType === 'board';
    return {
      label: `${isBoard ? '取締役会' : meeting ? '株主総会' : type.label}${meeting ? `: ${meeting.title}` : ''}`,
      path: isBoard ? '/board-meetings' : type.path,
    };
  }
  const title =
    document.entityType === 'financial_report'
      ? titles.financialReports.get(document.entityId)
      : document.entityType === 'shareholder_update'
        ? titles.updates.get(document.entityId)
        : undefined;
  return { label: title ? `${type.label}: ${title}` : type.label, path: type.path };
};

export const SHARE_LINK_STATUS_LABELS: Record<ShareLinkStatus, { label: string; tone: string }> = {
  active: { label: '有効', tone: 'gt-pill-good' },
  expired: { label: '期限切れ', tone: 'gt-pill-neutral' },
  revoked: { label: '取り消し済み', tone: 'gt-pill-bad' },
};

export const buildShareUrl = (origin: string, token: string): string => `${origin.replace(/\/+$/, '')}/share/${token}`;

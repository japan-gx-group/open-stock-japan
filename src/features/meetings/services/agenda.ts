// 議案の並び替えと、決議要件の判定（src/lib/legal/rules.ts の evaluateResolution）への橋渡し。サーバ依存なし。

import { evaluateResolution, type ResolutionEvaluation, type ResolutionType } from '@/lib/legal/rules';
import type { AgendaItemRow, MeetingRow } from '../types';

export const sortAgenda = <T extends Pick<AgendaItemRow, 'sortOrder'> & { createdAt?: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.sortOrder - b.sortOrder || (a.createdAt ?? '').localeCompare(b.createdAt ?? ''));

export const nextSortOrder = (items: Pick<AgendaItemRow, 'sortOrder'>[]): number =>
  items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;

/**
 * 並び順を 1 つ動かしたあとの、保存し直す行と新しい順番。
 * 並べ替え後に 1 から振り直し、順番が変わる行だけを返す（同じ順番の行が混じっていても直る）。
 */
export const moveAgendaItem = (
  items: Pick<AgendaItemRow, 'id' | 'sortOrder'>[],
  id: string,
  direction: 'up' | 'down',
): { id: string; sortOrder: number }[] => {
  const ordered = [...items];
  const index = ordered.findIndex((item) => item.id === id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || target < 0 || target >= ordered.length) return [];
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  return ordered
    .map((item, position) => ({ id: item.id, sortOrder: position + 1, previous: item.sortOrder }))
    .filter((item) => item.sortOrder !== item.previous)
    .map(({ id: itemId, sortOrder }) => ({ id: itemId, sortOrder }));
};

/** 頭数（309条3項・4項の判定に使う。台帳には保存しない） */
export interface HeadCounts {
  totalHolders: number | null;
  holdersFor: number | null;
}

export const needsHeadCount = (type: ResolutionType): boolean =>
  type === 'extraordinary_309_3' || type === 'extraordinary_309_4';

export interface AgendaVerdict {
  /** 判定に使った決議の種類（書面決議は全員の同意として判定する） */
  evaluatedAs: ResolutionType;
  evaluation: ResolutionEvaluation;
  /** approved: 要件を満たす / rejected: 満たさない / unknown: 数字が足りず判定できない */
  state: 'approved' | 'rejected' | 'unknown';
  label: string;
  /** 判定の説明（足りない数字・必要な賛成の数など） */
  message: string;
}

/** 会議の議決権の数と議案の賛成の数から、決議要件を満たすかを判定する */
export const agendaVerdict = (
  meeting: Pick<MeetingRow, 'format' | 'totalVotingRights' | 'presentVotingRights'>,
  item: Pick<AgendaItemRow, 'resolutionType' | 'votesFor'>,
  headCounts: HeadCounts = { totalHolders: null, holdersFor: null },
): AgendaVerdict => {
  // 書面決議（319条1項・370条）は、決議の種類にかかわらず全員の同意で成立する
  const evaluatedAs: ResolutionType = meeting.format === 'written_resolution' ? 'unanimous' : item.resolutionType;
  const evaluation = evaluateResolution(evaluatedAs, {
    totalVotes: meeting.totalVotingRights,
    presentVotes: meeting.presentVotingRights,
    votesFor: item.votesFor,
    totalHolders: headCounts.totalHolders,
    holdersFor: headCounts.holdersFor,
  });
  const state = evaluation.approved == null ? 'unknown' : evaluation.approved ? 'approved' : 'rejected';
  const label = state === 'unknown' ? '判定できません' : state === 'approved' ? '要件を満たしています' : '要件を満たしていません';
  // 取締役会では「議決権」ではなく取締役の人数で数える
  const message =
    evaluatedAs === 'board' && evaluation.quorumMet == null
      ? '取締役の総数と出席した取締役の数を入力すると判定します'
      : evaluation.message;
  return { evaluatedAs, evaluation, state, label, message };
};

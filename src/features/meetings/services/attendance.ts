// 出欠表（meeting-responses）の対象者の洗い出しと集計。サーバ依存なし。

import { buildRegistry } from '@/lib/equity/ledger';
import type { EquitySnapshot } from '@/lib/equity/types';
import { isAuditorCompany, type Governance } from '@/lib/legal/rules';
import type { OfficerRow, ResponseRow, ResponseValue } from '../types';

export interface VoterCandidate {
  stakeholderId: string;
  name: string;
  /** 議決権のある種類の株式の数の合計（1 株 1 議決権として数える。単元株・自己株式・相互保有は見ていない） */
  votingRights: number;
}

/** 基準日（asOf）時点で議決権のある株式を持つ株主と、その議決権の数 */
export const registryVoters = (snapshot: EquitySnapshot, asOf: string | null): VoterCandidate[] => {
  const votingClassIds = new Set(
    snapshot.shareClasses.filter((shareClass) => shareClass.hasVotingRights).map((shareClass) => shareClass.id),
  );
  const byStakeholder = new Map<string, VoterCandidate>();
  for (const row of buildRegistry(snapshot, asOf).rows) {
    if (!votingClassIds.has(row.shareClassId) || row.shares <= 0) continue;
    const current = byStakeholder.get(row.stakeholderId) ?? { stakeholderId: row.stakeholderId, name: row.name, votingRights: 0 };
    current.votingRights += row.shares;
    byStakeholder.set(row.stakeholderId, current);
  }
  return Array.from(byStakeholder.values()).sort(
    (a, b) => b.votingRights - a.votingRights || a.name.localeCompare(b.name, 'ja'),
  );
};

export type BoardRole = 'director' | 'auditor';

export interface BoardMember {
  officerId: string;
  name: string;
  position: string;
  role: BoardRole;
}

const DIRECTOR_POSITIONS = ['representative_director', 'director'];

export const isDirector = (position: string): boolean => DIRECTOR_POSITIONS.includes(position);

/** asOf の時点で在任している役員か（就任日・退任日が空なら在任として扱う） */
export const isActiveOfficer = (officer: Pick<OfficerRow, 'appointedOn' | 'retiredOn'>, asOf: string): boolean =>
  (officer.appointedOn == null || officer.appointedOn <= asOf) && (officer.retiredOn == null || officer.retiredOn > asOf);

/** 取締役会の出欠表の対象: 在任中の取締役（議決に加わる）と監査役（出席者として並べる） */
export const boardMembers = (officers: OfficerRow[], governance: Governance, asOf: string): BoardMember[] => {
  const members: BoardMember[] = [];
  for (const officer of officers) {
    if (!isActiveOfficer(officer, asOf)) continue;
    if (isDirector(officer.position)) {
      members.push({ officerId: officer.id, name: officer.name, position: officer.position, role: 'director' });
    } else if (officer.position === 'auditor' && governance.hasAuditor) {
      members.push({ officerId: officer.id, name: officer.name, position: officer.position, role: 'auditor' });
    }
  }
  const rank = (member: BoardMember): number =>
    member.position === 'representative_director' ? 0 : member.role === 'director' ? 1 : 2;
  return members.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ja'));
};

/** 会議に出席したものとして数える回答（株主総会: 本人出席・委任状・書面による議決権行使） */
const PRESENT_RESPONSES: readonly ResponseValue[] = ['attending', 'proxy', 'written_vote'];

export interface AttendanceTotals {
  /** 議決権を持つ人の数（株主総会は株主、取締役会は取締役） */
  memberCount: number;
  totalVotingRights: number;
  presentCount: number;
  presentVotingRights: number;
  consentCount: number;
  consentVotingRights: number;
  /** 回答が無い・不同意・欠席の人数（書面決議で全員の同意に足りない数） */
  consentMissing: number;
  /** 全員が同意したか（対象が 0 人なら false） */
  allConsented: boolean;
  noResponseCount: number;
}

/** 議決権を持つ行（株主総会は全行、取締役会は取締役の行）を集計する */
export const attendanceTotals = (rows: Pick<ResponseRow, 'response' | 'votingRights'>[]): AttendanceTotals => {
  const totals: AttendanceTotals = {
    memberCount: rows.length,
    totalVotingRights: 0,
    presentCount: 0,
    presentVotingRights: 0,
    consentCount: 0,
    consentVotingRights: 0,
    consentMissing: 0,
    allConsented: false,
    noResponseCount: 0,
  };
  for (const row of rows) {
    const votes = row.votingRights ?? 0;
    totals.totalVotingRights += votes;
    if (PRESENT_RESPONSES.includes(row.response)) {
      totals.presentCount += 1;
      totals.presentVotingRights += votes;
    }
    if (row.response === 'consent') {
      totals.consentCount += 1;
      totals.consentVotingRights += votes;
    }
    if (row.response === 'no_response') totals.noResponseCount += 1;
  }
  totals.consentMissing = totals.memberCount - totals.consentCount;
  totals.allConsented = totals.memberCount > 0 && totals.consentMissing === 0;
  return totals;
};

export interface BoardResponseSplit<T> {
  directors: T[];
  auditors: T[];
  /** 役員の一覧に見つからない行（退任・削除など） */
  others: T[];
}

/** 取締役会の出欠表を、取締役（議決に加わる）と監査役に分ける */
export const splitBoardResponses = <T extends Pick<ResponseRow, 'officerId'>>(
  rows: T[],
  officers: Pick<OfficerRow, 'id' | 'position'>[],
): BoardResponseSplit<T> => {
  const positionById = new Map(officers.map((officer) => [officer.id, officer.position]));
  const split: BoardResponseSplit<T> = { directors: [], auditors: [], others: [] };
  for (const row of rows) {
    const position = row.officerId ? positionById.get(row.officerId) : undefined;
    if (position && isDirector(position)) split.directors.push(row);
    else if (position === 'auditor') split.auditors.push(row);
    else split.others.push(row);
  }
  return split;
};

export interface WrittenResolutionStatus {
  /** 決議があったものとみなせる状態か */
  established: boolean;
  level: 'success' | 'warning';
  message: string;
}

/** 株主総会の書面決議（会社法319条1項）: 議決権を行使できる株主の全員の同意 */
export const shareholderWrittenStatus = (totals: AttendanceTotals): WrittenResolutionStatus => {
  if (totals.memberCount === 0) {
    return { established: false, level: 'warning', message: '同意を集める株主がまだ登録されていません。基準日の株主から表を作成してください。' };
  }
  if (totals.allConsented) {
    return { established: true, level: 'success', message: `全員の同意が揃いました（${totals.memberCount} 名）。議決権を行使できる株主の全員が書面または電磁的記録で同意したとき、決議があったものとみなされます（会社法319条1項）。` };
  }
  return { established: false, level: 'warning', message: `あと ${totals.consentMissing} 名の同意が必要です（同意 ${totals.consentCount} / ${totals.memberCount} 名）。書面決議は 1 名でも同意が欠けると成立しません（会社法319条1項）。` };
};

/** 取締役会の書面決議（会社法370条）: 定款の定め + 取締役全員の同意 + （監査役設置会社では）監査役が異議を述べないこと */
export const boardWrittenStatus = (
  directorTotals: AttendanceTotals,
  auditorRows: Pick<ResponseRow, 'response'>[],
  governance: Governance,
): WrittenResolutionStatus => {
  if (!governance.allowsBoardWrittenResolution) {
    return { established: false, level: 'warning', message: '定款に書面決議を認める定めが無いため、取締役会の書面決議（会社法370条）は使えません。' };
  }
  if (directorTotals.memberCount === 0) {
    return { established: false, level: 'warning', message: '同意を集める取締役がまだ登録されていません。在任中の役員から表を作成してください。' };
  }
  if (!directorTotals.allConsented) {
    return { established: false, level: 'warning', message: `あと ${directorTotals.consentMissing} 名の取締役の同意が必要です（同意 ${directorTotals.consentCount} / ${directorTotals.memberCount} 名）。議決に加わることができる取締役の全員の同意が必要です（会社法370条）。` };
  }
  if (isAuditorCompany(governance)) {
    const objections = auditorRows.filter((row) => row.response === 'dissent').length;
    if (objections > 0) {
      return { established: false, level: 'warning', message: `取締役の全員が同意していますが、監査役 ${objections} 名が異議を述べています。監査役設置会社では、監査役が異議を述べたときは書面決議は成立しません（会社法370条）。` };
    }
    return { established: true, level: 'success', message: `取締役の全員の同意が揃いました（${directorTotals.memberCount} 名）。監査役の異議もありません（会社法370条）。` };
  }
  return { established: true, level: 'success', message: `取締役の全員の同意が揃いました（${directorTotals.memberCount} 名）（会社法370条）。` };
};

// AI の下書き（招集通知・書面決議の提案書・議事録）に渡す材料を、登録済みの内容から日本語の文章に組み立てる。
// サーバ依存なし。ここで作るのは事実の列挙だけで、AI への指示は /api/ai/draft 側が持つ。

import { formatDateJa, formatDateWareki } from '@/lib/equity/format';
import { boardProcedureNotes, isAuditorCompany, LEGAL, RESOLUTION_REQUIREMENTS, type Governance } from '@/lib/legal/rules';
import {
  AGENDA_ITEM_TYPES,
  AGENDA_RESULTS,
  MEETING_FORMATS,
  MEETING_RESPONSES,
  MEETING_TYPES,
  OFFICER_POSITIONS,
} from '@/lib/resources/definitions';
import type { ResourceValues } from '@/lib/resources/fields';
import type { AgendaItemRow, MeetingRow, ResponseRow } from '../types';
import { sortAgenda } from './agenda';
import { isWrittenResolution, kindOfMeeting, noticeRuleFor, optionLabel, type DraftPurpose } from './meetingRules';

export interface ContextAttendee {
  name: string;
  /** 役職（取締役会）。株主は空 */
  position: string | null;
  response: ResponseRow['response'];
  votingRights: number | null;
  respondedOn: string | null;
}

export interface DraftContextInput {
  purpose: DraftPurpose;
  company: ResourceValues | null;
  governance: Governance;
  meeting: MeetingRow;
  fiscalYearLabel: string | null;
  agendaItems: AgendaItemRow[];
  attendees: ContextAttendee[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const number = (value: number | null | undefined): string => (value == null ? '未入力' : value.toLocaleString('ja-JP'));
const dateLine = (value: string | null): string => (value ? `${formatDateWareki(value)}（${formatDateJa(value)}）` : '未定');

const governanceLines = (governance: Governance, board: boolean): string[] => {
  const lines = [
    `- ${governance.isPublicCompany ? '公開会社' : '非公開会社（全部の株式に譲渡制限がある会社）'}`,
    `- ${governance.hasBoardOfDirectors ? '取締役会設置会社' : '取締役会を置かない会社'}`,
    `- ${
      !governance.hasAuditor
        ? '監査役を置いていない'
        : isAuditorCompany(governance)
          ? '監査役設置会社（監査役は業務監査の権限を持つ）'
          : '監査役の監査の範囲を会計に限定している（会社法2条9号の監査役設置会社には当たらない）'
    }`,
  ];
  const rule = noticeRuleFor(board ? 'board' : 'shareholder', governance);
  lines.push(`- 招集通知の期限: 会日の ${rule.days} 日前まで（${rule.basis}${rule.note ? `。${rule.note}` : ''}）`);
  if (board) {
    const notes = boardProcedureNotes(governance);
    lines.push(`- 取締役会の招集通知の宛先: ${notes.noticeTo}`);
    lines.push(`- 書面決議: ${notes.writtenResolution}`);
  }
  return lines;
};

const agendaLines = (items: AgendaItemRow[], withResults: boolean): string[] => {
  if (items.length === 0) return ['（議案は未登録）'];
  const lines: string[] = [];
  sortAgenda(items).forEach((item, index) => {
    const isResolution = item.itemType === 'resolution';
    const requirement = isResolution ? RESOLUTION_REQUIREMENTS[item.resolutionType] : null;
    lines.push(
      `${index + 1}. 【${optionLabel(AGENDA_ITEM_TYPES, item.itemType)}】${item.title}${
        requirement ? `（${requirement.label}・${requirement.basis}）` : ''
      }`,
    );
    if (text(item.description)) lines.push(`   内容: ${text(item.description).replace(/\s*\n\s*/g, ' / ')}`);
    if (withResults) {
      const votes = isResolution
        ? `賛成 ${number(item.votesFor)}、反対 ${number(item.votesAgainst)}、棄権 ${number(item.votesAbstain)}`
        : null;
      lines.push(`   結果: ${optionLabel(AGENDA_RESULTS, item.result)}${votes ? `（${votes}）` : ''}`);
    }
  });
  return lines;
};

const attendeeLines = (attendees: ContextAttendee[], board: boolean): string[] =>
  attendees.map((attendee) => {
    const position = attendee.position ? `${optionLabel(OFFICER_POSITIONS, attendee.position)} ` : '';
    const votes = !board && attendee.votingRights != null ? `、議決権 ${attendee.votingRights.toLocaleString('ja-JP')} 個` : '';
    const responded = attendee.respondedOn ? `、回答日 ${formatDateJa(attendee.respondedOn)}` : '';
    return `- ${position}${attendee.name}: ${optionLabel(MEETING_RESPONSES, attendee.response)}${votes}${responded}`;
  });

/** 招集通知・書面決議の提案書・議事録の下書きに渡す材料 */
export const buildDraftContext = (input: DraftContextInput): string => {
  const { purpose, company, governance, meeting, agendaItems, attendees } = input;
  const board = kindOfMeeting(meeting.meetingType) === 'board';
  const written = isWrittenResolution(meeting);
  const isMinutes = purpose === 'minutes';
  const lines: string[] = [];

  lines.push(
    `作成する文書: ${
      isMinutes
        ? written
          ? '議事録のみ（提案書・同意書は不要）'
          : '議事録'
        : written
          ? '提案書と同意書のひな形（議事録は不要）'
          : '招集通知'
    }`,
  );
  lines.push('');
  lines.push('■ 会社');
  lines.push(`- 商号: ${text(company?.name) || '未入力'}`);
  if (text(company?.address)) lines.push(`- 本店所在地: ${text(company?.address)}`);
  const representative = [text(company?.representativeTitle), text(company?.representativeName)].filter(Boolean).join(' ');
  lines.push(`- 代表者: ${representative || '未入力'}`);
  lines.push(...governanceLines(governance, board));

  lines.push('');
  lines.push('■ 会議');
  lines.push(`- 種類: ${optionLabel(MEETING_TYPES, meeting.meetingType)}`);
  lines.push(`- 名称: ${meeting.title}`);
  lines.push(`- 開催方法: ${optionLabel(MEETING_FORMATS, meeting.format)}`);
  if (written) {
    lines.push(`- 決議があったものとみなされる日: ${dateLine(meeting.heldOn)}`);
  } else {
    lines.push(`- 開催日: ${dateLine(meeting.heldOn)}`);
    lines.push(`- 開始時刻: ${meeting.startTime ? meeting.startTime.slice(0, 5) : '未定'}`);
    lines.push(`- 場所: ${text(meeting.place) || '未定'}`);
  }
  if (input.fiscalYearLabel) lines.push(`- 対象の事業年度: ${input.fiscalYearLabel}`);
  if (!board && meeting.recordDate) lines.push(`- 基準日: ${dateLine(meeting.recordDate)}`);
  if (meeting.noticeSentOn) lines.push(`- 招集通知を発送した日: ${dateLine(meeting.noticeSentOn)}`);
  if (text(meeting.chairperson)) lines.push(`- 議長: ${text(meeting.chairperson)}`);
  if (text(meeting.minutesPreparer)) lines.push(`- 議事録の作成に係る職務を行った取締役: ${text(meeting.minutesPreparer)}`);
  if (text(meeting.notes)) lines.push(`- メモ: ${text(meeting.notes).replace(/\s*\n\s*/g, ' / ')}`);

  lines.push('');
  lines.push(`■ 会議の目的事項（${isMinutes ? '結果を含む' : '予定'}）`);
  lines.push(...agendaLines(agendaItems, isMinutes));

  if (isMinutes) {
    lines.push('');
    lines.push(board ? '■ 取締役の数' : '■ 議決権の数');
    if (board) {
      lines.push(`- 取締役の総数（議決に加わることができる取締役）: ${number(meeting.totalVotingRights)} 名`);
      if (!written) lines.push(`- 出席した取締役の数: ${number(meeting.presentVotingRights)} 名`);
    } else {
      lines.push(`- 議決権を行使できる株主の議決権の総数: ${number(meeting.totalVotingRights)} 個`);
      lines.push(`- ${written ? '同意した' : '出席した（委任状・書面による議決権行使を含む）'}株主の議決権の数: ${number(meeting.presentVotingRights)} 個`);
      lines.push(`- ${written ? '同意した' : '出席した'}株主の数: ${number(meeting.presentShareholders)} 名`);
    }
    if (text(meeting.attendingOfficers)) lines.push(`- 出席した役員: ${text(meeting.attendingOfficers).replace(/\s*\n\s*/g, '、')}`);
  }

  if (attendees.length > 0 && (isMinutes || written)) {
    lines.push('');
    lines.push(written ? '■ 同意の状況' : '■ 出欠の記録');
    lines.push(...attendeeLines(attendees, board));
  }

  if (isMinutes) {
    lines.push('');
    lines.push('■ 議事録の扱い');
    lines.push(`- 本店に ${LEGAL.minutesRetentionYears} 年間備え置く（${board ? '会社法371条1項' : '会社法318条2項'}）`);
    lines.push(
      board
        ? written
          ? '- 書面決議のため出席者はいない（会社法369条3項の署名義務は条文上生じない）'
          : '- 出席した取締役および監査役が署名または記名押印する（会社法369条3項）'
        : '- 会社法上、株主総会議事録への署名・記名押印の義務は無い（定款に定めがあればそれに従う）',
    );
  }
  return lines.join('\n');
};

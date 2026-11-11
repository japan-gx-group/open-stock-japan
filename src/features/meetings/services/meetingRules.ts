// 会議の種類ごとの設定と、招集通知の期限・入力の注意・保存する値の組み立て。サーバ依存なし。
// 法令の数値は src/lib/legal/rules.ts の関数・定数から取る（ここに直接書かない）。

import { addMonths, diffDays, formatDateJa } from '@/lib/equity/format';
import {
  boardMeetingNoticeRule,
  isRecordDateValid,
  LEGAL,
  noticeDeadline,
  shareholderMeetingNoticeRule,
  type Governance,
  type NoticeRule,
} from '@/lib/legal/rules';
import { RESOURCES, type MeetingType, type ResourceName } from '@/lib/resources/definitions';
import type { ResourceValues } from '@/lib/resources/fields';
import type { MeetingKind, MeetingRow } from '../types';

export interface MeetingKindConfig {
  kind: MeetingKind;
  label: string;
  basePath: string;
  meetingTypes: readonly MeetingType[];
  defaultMeetingType: MeetingType;
  /** 出欠表の対象の呼び方 */
  memberLabel: string;
}

export const MEETING_KINDS: Record<MeetingKind, MeetingKindConfig> = {
  shareholder: {
    kind: 'shareholder',
    label: '株主総会',
    basePath: '/shareholder-meetings',
    meetingTypes: ['agm', 'egm', 'class_meeting'],
    defaultMeetingType: 'agm',
    memberLabel: '株主',
  },
  board: {
    kind: 'board',
    label: '取締役会',
    basePath: '/board-meetings',
    meetingTypes: ['board'],
    defaultMeetingType: 'board',
    memberLabel: '取締役',
  },
};

export const kindOfMeeting = (meetingType: string): MeetingKind => (meetingType === 'board' ? 'board' : 'shareholder');

export const isWrittenResolution = (meeting: Pick<MeetingRow, 'format'>): boolean => meeting.format === 'written_resolution';

/** 選択肢の一覧から表示名を引く */
export const optionLabel = (options: readonly { value: string; label: string }[], value: unknown): string =>
  options.find((option) => option.value === value)?.label ?? (typeof value === 'string' && value ? value : '—');

export const noticeRuleFor = (kind: MeetingKind, governance: Governance): NoticeRule =>
  kind === 'board' ? boardMeetingNoticeRule(governance) : shareholderMeetingNoticeRule(governance);

export type NoticeState =
  /** 書面決議は招集通知が無い */
  | 'not_required'
  /** 開催日が未定で期限を計算できない */
  | 'no_date'
  | 'sent'
  /** 期限を過ぎてから発送した */
  | 'sent_late'
  /** 未発送のまま開催済み */
  | 'past'
  | 'overdue'
  | 'soon'
  | 'upcoming';

export interface NoticeInfo {
  state: NoticeState;
  rule: NoticeRule;
  /** 発送の期限（最終発送日）。計算できないときは null */
  deadline: string | null;
  /** 今日から期限までの日数（過ぎていれば負） */
  daysLeft: number | null;
  label: string;
}

/** 「あと何日」を「期限が近い」と表示する境目 */
export const NOTICE_SOON_DAYS = 7;

/** 招集通知の発送期限と、今の状態 */
export const noticeInfo = (
  meeting: Pick<MeetingRow, 'meetingType' | 'format' | 'status' | 'heldOn' | 'noticeSentOn'>,
  governance: Governance,
  today: string,
): NoticeInfo => {
  const rule = noticeRuleFor(kindOfMeeting(meeting.meetingType), governance);
  if (isWrittenResolution(meeting)) {
    return { state: 'not_required', rule, deadline: null, daysLeft: null, label: '書面決議のため招集通知なし' };
  }
  if (!meeting.heldOn) {
    return { state: 'no_date', rule, deadline: null, daysLeft: null, label: '開催日が未定' };
  }
  const deadline = noticeDeadline(meeting.heldOn, rule.days);
  const daysLeft = diffDays(today, deadline);
  if (meeting.noticeSentOn) {
    const late = meeting.noticeSentOn > deadline;
    return {
      state: late ? 'sent_late' : 'sent',
      rule,
      deadline,
      daysLeft,
      label: late ? '期限後に発送' : '発送済み',
    };
  }
  if (meeting.status === 'held' || meeting.status === 'closed') {
    return { state: 'past', rule, deadline, daysLeft, label: '発送日の記録なし' };
  }
  if (daysLeft < 0) return { state: 'overdue', rule, deadline, daysLeft, label: `期限超過（${-daysLeft} 日）` };
  if (daysLeft <= NOTICE_SOON_DAYS) {
    return { state: 'soon', rule, deadline, daysLeft, label: daysLeft === 0 ? '今日が期限' : `あと ${daysLeft} 日` };
  }
  return { state: 'upcoming', rule, deadline, daysLeft, label: `あと ${daysLeft} 日` };
};

export interface MeetingWarning {
  key: string;
  level: 'warning' | 'info';
  message: string;
}

/** 基本情報の注意（保存は止めない） */
export const meetingWarnings = (meeting: MeetingRow, governance: Governance, today: string): MeetingWarning[] => {
  const kind = kindOfMeeting(meeting.meetingType);
  const warnings: MeetingWarning[] = [];

  if (kind === 'shareholder' && meeting.recordDate && meeting.heldOn && !isRecordDateValid(meeting.recordDate, meeting.heldOn)) {
    warnings.push({
      key: 'record-date',
      level: 'warning',
      message: `基準日（${formatDateJa(meeting.recordDate)}）から開催日までが ${LEGAL.recordDateMaxMonths} か月を超えています。基準日株主が権利を行使できるのは基準日から ${LEGAL.recordDateMaxMonths} か月以内（${formatDateJa(addMonths(meeting.recordDate, LEGAL.recordDateMaxMonths))} まで）です（会社法124条2項）。`,
    });
  }

  const notice = noticeInfo(meeting, governance, today);
  if (notice.state === 'sent_late' && notice.deadline) {
    warnings.push({
      key: 'notice-late',
      level: 'warning',
      message: `招集通知の発送日（${formatDateJa(meeting.noticeSentOn)}）が期限（${formatDateJa(notice.deadline)}。会日の ${notice.rule.days} 日前まで: ${notice.rule.basis}）より後です。${
        kind === 'board'
          ? '取締役（監査役設置会社では取締役および監査役）の全員の同意があれば招集手続を省略できます（会社法368条2項）。'
          : '株主全員の同意があれば招集手続を省略できます（会社法300条）。同意を得ている場合は、その記録を残してください。'
      }`,
    });
  }
  if (notice.state === 'overdue' && notice.deadline) {
    warnings.push({
      key: 'notice-overdue',
      level: 'warning',
      message: `招集通知の発送期限（${formatDateJa(notice.deadline)}）を過ぎています。発送済みなら発送日を記録してください。${
        kind === 'board'
          ? '取締役（監査役設置会社では取締役および監査役）の全員の同意があれば招集手続を省略できます（会社法368条2項）。'
          : '株主全員の同意があれば招集手続を省略できます（会社法300条）。'
      }`,
    });
  }

  if (kind === 'board' && isWrittenResolution(meeting) && !governance.allowsBoardWrittenResolution) {
    warnings.push({
      key: 'board-written',
      level: 'warning',
      message:
        '開催方法が書面決議ですが、会社情報では「定款に取締役会の書面決議（370条）の定めがある」になっていません。定款に定めが無いと取締役会の書面決議は使えません（会社法370条）。定款を確かめ、定めがある場合は会社情報を直してください。',
    });
  }
  if (kind === 'board' && !governance.hasBoardOfDirectors) {
    warnings.push({
      key: 'no-board',
      level: 'info',
      message: '会社情報では取締役会設置会社になっていません。取締役会を置かない会社では、業務は取締役の過半数で決定します（会社法348条）。',
    });
  }

  if (meeting.meetingType === 'agm' && !meeting.fiscalYearId) {
    warnings.push({
      key: 'agm-fiscal-year',
      level: 'warning',
      message: '定時株主総会に対象の事業年度が選ばれていません。手続きカレンダーで開催済みと判定するために、事業年度を選んでください。',
    });
  }
  return warnings;
};

/**
 * 更新は全体の置き換えなので、行の全項目を送る値にする（immutable の項目は送らない）。
 * overrides で一部の項目だけ差し替える。
 */
export const fullPayload = (
  resource: ResourceName,
  row: ResourceValues,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  for (const field of RESOURCES[resource].fields) {
    if (field.immutable) continue;
    payload[field.key] = field.key in overrides ? overrides[field.key] : (row[field.key] ?? null);
  }
  return payload;
};

export type DraftPurpose = 'notice' | 'minutes';

/** AI の下書きの種類（DraftDialog の kind） */
export const draftKindFor = (
  meeting: Pick<MeetingRow, 'meetingType' | 'format'>,
  purpose: DraftPurpose,
):
  | 'shareholder_meeting_notice'
  | 'shareholder_meeting_minutes'
  | 'shareholder_written_resolution'
  | 'board_meeting_notice'
  | 'board_meeting_minutes'
  | 'board_written_resolution' => {
  const board = kindOfMeeting(meeting.meetingType) === 'board';
  // 書面決議は、提案書・同意書も議事録（施規72条4項1号・101条4項1号）も書面決議用の下書きを使う
  if (isWrittenResolution(meeting)) return board ? 'board_written_resolution' : 'shareholder_written_resolution';
  if (purpose === 'minutes') return board ? 'board_meeting_minutes' : 'shareholder_meeting_minutes';
  return board ? 'board_meeting_notice' : 'shareholder_meeting_notice';
};

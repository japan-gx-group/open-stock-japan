import { describe, expect, it } from 'vitest';
import { DEFAULT_GOVERNANCE, type Governance } from '@/lib/legal/rules';
import type { MeetingRow } from '../../types';
import { draftKindFor, fullPayload, meetingWarnings, noticeInfo } from '../meetingRules';

const governance: Governance = { ...DEFAULT_GOVERNANCE };

const meeting = (overrides: Partial<MeetingRow> = {}): MeetingRow => ({
  id: 'm1',
  meetingType: 'agm',
  title: '第3期 定時株主総会',
  format: 'in_person',
  status: 'planning',
  heldOn: '2026-06-27',
  startTime: '10:00',
  place: '本店',
  fiscalYearId: 'fy1',
  recordDate: '2026-03-31',
  noticeSentOn: null,
  chairperson: '',
  minutesPreparer: '',
  attendingOfficers: '',
  totalVotingRights: null,
  presentVotingRights: null,
  presentShareholders: null,
  minutesFinalizedOn: null,
  minutesBody: '',
  notes: '',
  ...overrides,
});

describe('noticeInfo', () => {
  it('非公開会社の株主総会は会日の 1 週間前まで（6/27 → 6/19 が最終発送日）', () => {
    const info = noticeInfo(meeting(), governance, '2026-06-01');
    expect(info.deadline).toBe('2026-06-19');
    expect(info.state).toBe('upcoming');
    expect(info.daysLeft).toBe(18);
  });

  it('公開会社は 2 週間前まで（6/27 → 6/12）', () => {
    expect(noticeInfo(meeting(), { ...governance, isPublicCompany: true }, '2026-06-01').deadline).toBe('2026-06-12');
  });

  it('期限が近い・過ぎた・発送済み・期限後の発送を区別する', () => {
    expect(noticeInfo(meeting(), governance, '2026-06-15').state).toBe('soon');
    expect(noticeInfo(meeting(), governance, '2026-06-19').label).toBe('今日が期限');
    expect(noticeInfo(meeting(), governance, '2026-06-20').state).toBe('overdue');
    expect(noticeInfo(meeting({ noticeSentOn: '2026-06-19' }), governance, '2026-06-25').state).toBe('sent');
    expect(noticeInfo(meeting({ noticeSentOn: '2026-06-20' }), governance, '2026-06-25').state).toBe('sent_late');
  });

  it('開催済みで発送日が無ければ期限超過とはしない', () => {
    expect(noticeInfo(meeting({ status: 'closed' }), governance, '2026-07-01').state).toBe('past');
  });

  it('書面決議と開催日未定は期限を出さない', () => {
    expect(noticeInfo(meeting({ format: 'written_resolution' }), governance, '2026-06-01').state).toBe('not_required');
    expect(noticeInfo(meeting({ heldOn: null }), governance, '2026-06-01').state).toBe('no_date');
  });

  it('取締役会は定款で短縮した日数を使う', () => {
    const info = noticeInfo(meeting({ meetingType: 'board', heldOn: '2026-12-18' }), { ...governance, boardMeetingNoticeDays: 3 }, '2026-12-01');
    expect(info.rule.days).toBe(3);
    expect(info.deadline).toBe('2026-12-14');
  });
});

describe('meetingWarnings', () => {
  const keys = (row: MeetingRow, gov: Governance = governance, today = '2026-06-01') =>
    meetingWarnings(row, gov, today).map((warning) => warning.key);

  it('問題が無ければ空', () => {
    expect(keys(meeting())).toEqual([]);
  });

  it('基準日から 3 か月を超える開催日を注意する', () => {
    expect(keys(meeting({ heldOn: '2026-06-30' }))).toEqual([]);
    expect(keys(meeting({ heldOn: '2026-07-01' }))).toContain('record-date');
  });

  it('期限後の発送・未発送の期限超過を注意する', () => {
    expect(keys(meeting({ noticeSentOn: '2026-06-22' }))).toContain('notice-late');
    expect(keys(meeting(), governance, '2026-06-21')).toContain('notice-overdue');
  });

  it('定款の定めが無い取締役会の書面決議を注意する', () => {
    const board = meeting({ meetingType: 'board', format: 'written_resolution', fiscalYearId: null, recordDate: null });
    expect(keys(board)).toContain('board-written');
    expect(keys(board, { ...governance, allowsBoardWrittenResolution: true })).not.toContain('board-written');
  });

  it('事業年度の無い定時株主総会を注意する（臨時は対象外）', () => {
    expect(keys(meeting({ fiscalYearId: null }))).toContain('agm-fiscal-year');
    expect(keys(meeting({ meetingType: 'egm', fiscalYearId: null }))).not.toContain('agm-fiscal-year');
  });
});

describe('fullPayload', () => {
  it('会議の全項目（議事録を含む）を送り、指定した項目だけ差し替える', () => {
    const payload = fullPayload('meetings', meeting({ minutesBody: '旧' }), { minutesBody: '新', status: 'closed' });
    expect(payload.minutesBody).toBe('新');
    expect(payload.status).toBe('closed');
    expect(payload.title).toBe('第3期 定時株主総会');
    expect(payload.recordDate).toBe('2026-03-31');
    expect(payload.noticeSentOn).toBeNull();
    expect(payload).not.toHaveProperty('id');
  });

  it('作成後に変えられない項目（親の id）は送らない', () => {
    const payload = fullPayload('meeting-responses', { meetingId: 'm1', stakeholderId: 's1', officerId: null, response: 'attending', votingRights: 10, respondedOn: null, notes: '' });
    expect(Object.keys(payload).sort()).toEqual(['notes', 'respondedOn', 'response', 'votingRights']);
  });
});

describe('draftKindFor', () => {
  it('会議の種類・開催方法・用途から下書きの種類を決める', () => {
    expect(draftKindFor({ meetingType: 'agm', format: 'in_person' }, 'notice')).toBe('shareholder_meeting_notice');
    expect(draftKindFor({ meetingType: 'egm', format: 'online' }, 'minutes')).toBe('shareholder_meeting_minutes');
    expect(draftKindFor({ meetingType: 'egm', format: 'written_resolution' }, 'notice')).toBe('shareholder_written_resolution');
    expect(draftKindFor({ meetingType: 'board', format: 'hybrid' }, 'notice')).toBe('board_meeting_notice');
    expect(draftKindFor({ meetingType: 'board', format: 'hybrid' }, 'minutes')).toBe('board_meeting_minutes');
    expect(draftKindFor({ meetingType: 'board', format: 'written_resolution' }, 'minutes')).toBe('board_written_resolution');
  });
});

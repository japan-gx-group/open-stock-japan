import { describe, expect, it } from 'vitest';
import { DEFAULT_GOVERNANCE } from '@/lib/legal/rules';
import type { AgendaItemRow, MeetingRow } from '../../types';
import { buildDraftContext, type DraftContextInput } from '../draftContext';

const meeting: MeetingRow = {
  id: 'm1',
  meetingType: 'agm',
  title: '第3期 定時株主総会',
  format: 'in_person',
  status: 'held',
  heldOn: '2026-06-26',
  startTime: '10:00:00',
  place: '当社本店会議室',
  fiscalYearId: 'fy',
  recordDate: '2026-03-31',
  noticeSentOn: '2026-06-11',
  chairperson: '創業 太郎',
  minutesPreparer: '創業 太郎',
  attendingOfficers: '取締役 創業 太郎\n監査役 監査 六郎',
  totalVotingRights: 1000,
  presentVotingRights: 900,
  presentShareholders: 3,
  minutesFinalizedOn: null,
  minutesBody: '',
  notes: '',
};

const item = (overrides: Partial<AgendaItemRow>): AgendaItemRow => ({
  id: 'a',
  meetingId: 'm1',
  sortOrder: 1,
  itemType: 'resolution',
  title: '第1号議案 計算書類承認の件',
  resolutionType: 'ordinary',
  result: 'approved',
  votesFor: 900,
  votesAgainst: 0,
  votesAbstain: 0,
  description: '',
  ...overrides,
});

const input = (overrides: Partial<DraftContextInput> = {}): DraftContextInput => ({
  purpose: 'notice',
  company: { name: '株式会社サンプル', representativeTitle: '代表取締役', representativeName: '創業 太郎', address: '東京都' },
  governance: DEFAULT_GOVERNANCE,
  meeting,
  fiscalYearLabel: '第3期',
  agendaItems: [
    item({ id: 'b', sortOrder: 2, title: '第2号議案 定款一部変更の件', resolutionType: 'special', description: '第5条を変更\n理由: 事業目的の追加' }),
    item({ id: 'a', sortOrder: 1 }),
    item({ id: 'r', sortOrder: 0, itemType: 'report', title: '事業報告の件', result: 'reported' }),
  ],
  attendees: [{ name: '創業 太郎', position: null, response: 'attending', votingRights: 800, respondedOn: '2026-06-20' }],
  ...overrides,
});

describe('buildDraftContext', () => {
  it('招集通知: 会社・会議・議案を順番どおりに並べ、結果や出欠は含めない', () => {
    const context = buildDraftContext(input());
    expect(context).toContain('作成する文書: 招集通知');
    expect(context).toContain('- 商号: 株式会社サンプル');
    expect(context).toContain('- 代表者: 代表取締役 創業 太郎');
    expect(context).toContain('- 開催日: 令和8年6月26日（2026年6月26日）');
    expect(context).toContain('- 開始時刻: 10:00');
    expect(context).toContain('- 対象の事業年度: 第3期');
    expect(context).toContain('- 招集通知の期限: 会日の 7 日前まで');
    expect(context.indexOf('事業報告の件')).toBeLessThan(context.indexOf('第1号議案'));
    expect(context.indexOf('第1号議案')).toBeLessThan(context.indexOf('第2号議案'));
    expect(context).toContain('2. 【決議事項】第1号議案 計算書類承認の件（普通決議・会社法309条1項）');
    expect(context).toContain('内容: 第5条を変更 / 理由: 事業目的の追加');
    expect(context).not.toContain('結果:');
    expect(context).not.toContain('■ 出欠の記録');
  });

  it('議事録: 議決権の数・結果・出欠・備置きの年数を含める', () => {
    const context = buildDraftContext(input({ purpose: 'minutes' }));
    expect(context).toContain('作成する文書: 議事録');
    expect(context).toContain('- 議決権を行使できる株主の議決権の総数: 1,000 個');
    expect(context).toContain('結果: 可決（賛成 900、反対 0、棄権 0）');
    expect(context).toContain('結果: 報告済み');
    expect(context).toContain('- 創業 太郎: 出席、議決権 800 個、回答日 2026年6月20日');
    expect(context).toContain('- 出席した役員: 取締役 創業 太郎、監査役 監査 六郎');
    expect(context).toContain('10 年間備え置く（会社法318条2項）');
    expect(context).toContain('署名・記名押印の義務は無い');
  });

  it('取締役会の議事録: 取締役の数と署名・記名押印（369条3項）を伝える', () => {
    const context = buildDraftContext(
      input({
        purpose: 'minutes',
        meeting: { ...meeting, meetingType: 'board', title: '第18回 取締役会', totalVotingRights: 3, presentVotingRights: 3, recordDate: null },
        attendees: [{ name: '創業 太郎', position: 'representative_director', response: 'attending', votingRights: 1, respondedOn: null }],
      }),
    );
    expect(context).toContain('- 取締役の総数（議決に加わることができる取締役）: 3 名');
    expect(context).toContain('- 代表取締役 創業 太郎: 出席');
    expect(context).toContain('- 取締役会の招集通知の宛先: 各取締役および各監査役');
    expect(context).toContain('署名または記名押印する（会社法369条3項）');
    expect(context).toContain('会社法371条1項');
    expect(context).not.toContain('基準日');
  });

  it('書面決議: みなし決議の日と同意の状況を含め、日時・場所は含めない', () => {
    const context = buildDraftContext(
      input({
        meeting: { ...meeting, format: 'written_resolution', startTime: null, place: '' },
        attendees: [{ name: '創業 太郎', position: null, response: 'consent', votingRights: 800, respondedOn: null }],
      }),
    );
    expect(context).toContain('作成する文書: 提案書と同意書のひな形（議事録は不要）');
    expect(context).toContain('- 決議があったものとみなされる日: 令和8年6月26日');
    expect(context).not.toContain('開始時刻');
    expect(context).toContain('■ 同意の状況');
    expect(context).toContain('- 創業 太郎: 同意（書面決議）、議決権 800 個');
  });

  it('未入力の項目は未入力・未定と書く（AI に作らせない）', () => {
    const context = buildDraftContext(input({ company: null, agendaItems: [], meeting: { ...meeting, heldOn: null, startTime: null, place: '' } }));
    expect(context).toContain('- 商号: 未入力');
    expect(context).toContain('- 開催日: 未定');
    expect(context).toContain('- 場所: 未定');
    expect(context).toContain('（議案は未登録）');
  });
});

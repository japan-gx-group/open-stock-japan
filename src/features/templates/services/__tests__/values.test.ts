import { describe, expect, it } from 'vitest';
import type { ResourceValues } from '@/lib/resources/fields';
import { TEMPLATE_KIND_DEFS, scopesOfKind } from '../kinds';
import { PLACEHOLDERS, placeholdersFor } from '../placeholders';
import { companyValues, formatTimeJa, investmentValues, meetingValues, roundValues, sampleValues, withAllNames } from '../values';

const company: ResourceValues = {
  name: '株式会社サンプル',
  address: '東京都千代田区丸の内一丁目1番1号',
  representativeTitle: '代表取締役',
  representativeName: '山田 太郎',
};

const meeting: ResourceValues = {
  meetingType: 'agm',
  title: '第3期 定時株主総会',
  format: 'in_person',
  heldOn: '2026-06-26',
  startTime: '10:00:00',
  place: '当社本店会議室',
  recordDate: '2026-03-31',
  noticeSentOn: '2026-06-10',
  chairperson: '山田 太郎',
  minutesPreparer: '山田 太郎',
  attendingOfficers: '代表取締役 山田 太郎\n取締役 鈴木 花子',
  totalVotingRights: 10000,
  presentVotingRights: 9000,
  presentShareholders: 4,
};

const agendaItems: ResourceValues[] = [
  { sortOrder: 2, itemType: 'resolution', title: '第3期計算書類承認の件', resolutionType: 'ordinary', description: '計算書類の承認を求める。', result: 'approved', votesFor: 9000, votesAgainst: 0, votesAbstain: 0 },
  { sortOrder: 1, itemType: 'report', title: '第3期事業報告の件', resolutionType: 'ordinary', description: '', result: 'reported', votesFor: null, votesAgainst: null, votesAbstain: null },
  { sortOrder: 3, itemType: 'resolution', title: '定款一部変更の件', resolutionType: 'special', description: '', result: 'pending', votesFor: null, votesAgainst: null, votesAbstain: null },
];

describe('formatTimeJa', () => {
  it('午前・午後に直す（正午からの 1 時間は「午後0時」）', () => {
    expect(formatTimeJa('10:00')).toBe('午前10時00分');
    expect(formatTimeJa('13:30:00')).toBe('午後1時30分');
    expect(formatTimeJa('12:30')).toBe('午後0時30分');
    expect(formatTimeJa('00:05')).toBe('午前0時05分');
  });

  it('時刻でない値は null', () => {
    expect(formatTimeJa('')).toBeNull();
    expect(formatTimeJa(null)).toBeNull();
    expect(formatTimeJa('25:00')).toBeNull();
  });
});

describe('companyValues', () => {
  it('会社情報と作成日（和暦と西暦）を入れる', () => {
    const values = companyValues(company, '2026-11-11');
    expect(values['会社名']).toBe('株式会社サンプル');
    expect(values['代表者']).toBe('代表取締役　山田 太郎');
    expect(values['作成日']).toBe('令和8年11月11日');
    expect(values['作成日（西暦）']).toBe('2026年11月11日');
  });

  it('未入力の項目は null（文書では【要確認】になる）', () => {
    const values = companyValues({ name: '株式会社サンプル', address: '', representativeTitle: '代表取締役', representativeName: null }, '2026-11-11');
    expect(values['本店所在地']).toBeNull();
    expect(values['代表者']).toBeNull();
    expect(values['代表者の氏名']).toBeNull();
    expect(companyValues(null, '2026-11-11')['会社名']).toBeNull();
  });
});

describe('meetingValues（株主総会）', () => {
  const values = meetingValues({ meeting, agendaItems, responses: [{}, {}, {}, {}, {}], fiscalYearLabel: '第3期' });

  it('日付は和暦と西暦、開催日時には曜日と開始時刻を付ける', () => {
    expect(values['開催日']).toBe('令和8年6月26日');
    expect(values['開催日（西暦）']).toBe('2026年6月26日');
    expect(values['開催日時']).toBe('令和8年6月26日（金曜日）午前10時00分');
    expect(values['基準日']).toBe('令和8年3月31日');
  });

  it('数は数字だけ（単位はテンプレートの文面に書く）', () => {
    expect(values['議決権の総数']).toBe('10,000');
    expect(values['出席議決権数']).toBe('9,000');
    expect(values['出席株主数']).toBe('4');
    expect(values['株主の総数']).toBe('5');
  });

  it('議案は並び順のとおり。決議事項にだけ「第 n 号議案」の番号を振る', () => {
    expect(values['報告事項']).toBe('1. 第3期事業報告の件');
    expect(values['決議事項']).toBe('第1号議案　第3期計算書類承認の件\n第2号議案　定款一部変更の件');
    expect(values['議案の内容']).toBe(
      '第1号議案　第3期計算書類承認の件\n　計算書類の承認を求める。\n\n第2号議案　定款一部変更の件\n　【要確認: 議案の内容】',
    );
  });

  it('議案の名称に「第1号議案」と書いて登録してあっても、番号を二重にしない（並び順から振り直す）', () => {
    const numbered = meetingValues({
      meeting,
      agendaItems: [
        { sortOrder: 1, itemType: 'resolution', title: '第2号議案 定款一部変更の件', resolutionType: 'special', description: '', result: 'pending' },
        { sortOrder: 2, itemType: 'resolution', title: '第３号議案：取締役選任の件', resolutionType: 'ordinary', description: '', result: 'pending' },
      ],
      responses: [],
      fiscalYearLabel: null,
    });
    expect(numbered['決議事項']).toBe('第1号議案\u3000定款一部変更の件\n第2号議案\u3000取締役選任の件');
  });

  it('議案と結果には、決議の種類と賛否の数を書く。未決の議案は【要確認】にする', () => {
    expect(values['議案と結果']).toBe(
      [
        '報告事項　第3期事業報告の件\n　上記について、報告があった。',
        '第1号議案　第3期計算書類承認の件\n　計算書類の承認を求める。\n　結果: 可決（普通決議。賛成 9,000 個、反対 0 個、棄権 0 個）',
        '第2号議案　定款一部変更の件\n　結果: 【要確認: 採決の結果】',
      ].join('\n\n'),
    );
  });

  it('出席した役員の改行は「、」でつなぐ', () => {
    expect(values['出席した役員']).toBe('代表取締役 山田 太郎、取締役 鈴木 花子');
  });

  it('議案が 1 件も無いうちは「なし」と書かずに null にする（埋めてもらう）', () => {
    const empty = meetingValues({ meeting, agendaItems: [], responses: [], fiscalYearLabel: null });
    expect(empty['報告事項']).toBeNull();
    expect(empty['決議事項']).toBeNull();
    expect(empty['議案と結果']).toBeNull();
    expect(empty['株主の総数']).toBeNull();
  });

  it('決議事項だけの会議では、報告事項は「なし」', () => {
    const onlyResolutions = meetingValues({ meeting, agendaItems: [agendaItems[0]], responses: [], fiscalYearLabel: null });
    expect(onlyResolutions['報告事項']).toBe('なし');
  });

  it('開催日が未定なら、開催日・開催日時は null', () => {
    const undated = meetingValues({ meeting: { ...meeting, heldOn: null }, agendaItems, responses: [], fiscalYearLabel: null });
    expect(undated['開催日']).toBeNull();
    expect(undated['開催日時']).toBeNull();
  });
});

describe('meetingValues（取締役会）', () => {
  it('取締役の数を入れ、株主総会だけの項目（基準日・議決権）は入れない', () => {
    const values = meetingValues({
      meeting: { ...meeting, meetingType: 'board', title: '第12回 取締役会', totalVotingRights: 3, presentVotingRights: 3 },
      agendaItems: [{ sortOrder: 1, itemType: 'resolution', title: '株主総会招集の件', resolutionType: 'board', description: '', result: 'approved', votesFor: 3, votesAgainst: 0, votesAbstain: null }],
      responses: [],
      fiscalYearLabel: null,
    });
    expect(values['取締役の総数']).toBe('3');
    expect(values['出席取締役数']).toBe('3');
    expect(values['議案と結果']).toBe('第1号議案　株主総会招集の件\n　結果: 可決（取締役会決議。賛成 3 名、反対 0 名）');
    expect(Object.hasOwn(values, '基準日')).toBe(false);
    expect(Object.hasOwn(values, '議決権の総数')).toBe(false);
  });
});

describe('roundValues・investmentValues', () => {
  const round: ResourceValues = {
    name: '第1回 J-KISS 型新株予約権',
    instrumentType: 'jkiss',
    valuationCap: 300_000_000,
    capBasis: 'post_money',
    discountRate: 0.2,
    qualifiedFinancingAmount: 100_000_000,
    issueDate: '2026-07-01',
    conversionDeadline: '2028-01-01',
  };
  const entries = [
    { investment: { id: 'i1', amount: 20_000_000, investmentDate: '2026-07-01' }, stakeholder: { name: '株式会社シードファンド', address: '東京都港区六本木一丁目1番1号' } },
    { investment: { id: 'i2', amount: 10_000_000, investmentDate: null }, stakeholder: null },
  ];
  const values = roundValues(round, entries);

  it('金額と率は数字だけ。ディスカウントからは、転換価額の乗率も出す', () => {
    expect(values['評価上限額']).toBe('300,000,000');
    expect(values['適格資金調達の金額']).toBe('100,000,000');
    expect(values['ディスカウント率']).toBe('20');
    expect(values['転換価額の乗率']).toBe('0.8');
    expect(values['評価上限額の基準']).toBe('ポストマネー');
    expect(values['証券の種類']).toBe('J-KISS 型新株予約権');
  });

  it('端数のあるディスカウントも、浮動小数の誤差を出さない', () => {
    const odd = roundValues({ ...round, discountRate: 0.125 }, []);
    expect(odd['ディスカウント率']).toBe('12.5');
    expect(odd['転換価額の乗率']).toBe('0.875');
  });

  it('登記の期限は、発行日（割当日）の 2 週間後', () => {
    expect(values['発行日']).toBe('令和8年7月1日');
    expect(values['登記の期限']).toBe('令和8年7月15日');
    expect(values['登記の期限（西暦）']).toBe('2026年7月15日');
    expect(roundValues({ ...round, issueDate: null }, [])['登記の期限']).toBeNull();
  });

  it('投資家の一覧と合計。名前の分からない投資家は【要確認】にする', () => {
    expect(values['投資家の数']).toBe('2');
    expect(values['投資額の合計']).toBe('30,000,000');
    expect(values['投資家の一覧']).toBe('株式会社シードファンド　金20,000,000円（払込日: 令和8年7月1日）\n【要確認: 投資家名】　金10,000,000円');
  });

  it('評価上限額が無い回次・投資が無い回次は null', () => {
    const bare = roundValues({ ...round, valuationCap: null }, []);
    expect(bare['評価上限額']).toBeNull();
    expect(bare['投資家の一覧']).toBeNull();
    expect(bare['投資額の合計']).toBeNull();
  });

  it('投資家 1 名ぶんの値', () => {
    const investor = investmentValues(entries[0]);
    expect(investor['投資家名']).toBe('株式会社シードファンド');
    expect(investor['投資額']).toBe('20,000,000');
    expect(investor['払込日']).toBe('令和8年7月1日');
    expect(investmentValues(entries[1])['投資家名']).toBeNull();
  });
});

describe('差し込み項目の一覧と、値の組み立ての対応', () => {
  it('一覧にあるすべての項目に、値を入れる処理がある（項目を足して、値を入れ忘れない）', () => {
    const produced = new Set([
      ...Object.keys(companyValues(company, '2026-11-11')),
      ...Object.keys(meetingValues({ meeting, agendaItems, responses: [], fiscalYearLabel: '第3期' })),
      ...Object.keys(meetingValues({ meeting: { ...meeting, meetingType: 'board' }, agendaItems, responses: [], fiscalYearLabel: null })),
      ...Object.keys(roundValues({}, [])),
      ...Object.keys(investmentValues({ investment: {}, stakeholder: null })),
    ]);
    expect(PLACEHOLDERS.map((def) => def.name).filter((name) => !produced.has(name))).toEqual([]);
  });

  it('値を入れる処理は、一覧に無い名前を作らない', () => {
    const known = new Set(PLACEHOLDERS.map((def) => def.name));
    const produced = [
      ...Object.keys(companyValues(company, '2026-11-11')),
      ...Object.keys(meetingValues({ meeting, agendaItems, responses: [], fiscalYearLabel: '第3期' })),
      ...Object.keys(roundValues({}, [])),
      ...Object.keys(investmentValues({ investment: {}, stakeholder: null })),
    ];
    expect(produced.filter((name) => !known.has(name))).toEqual([]);
  });

  it('withAllNames は、その種類で使える名前のうち、値の無いものを null で補う', () => {
    const scopes = scopesOfKind(TEMPLATE_KIND_DEFS.find((kind) => kind.id === 'convertible_payment_notice')!);
    const values = withAllNames({ 会社名: 'A社' }, scopes);
    expect(values['会社名']).toBe('A社');
    expect(Object.hasOwn(values, '投資額')).toBe(true);
    expect(values['投資額']).toBeNull();
    // 会議の項目は、この種類では使えないので入らない
    expect(Object.hasOwn(values, '開催日')).toBe(false);
  });

  it('見本の値は、その種類で使えるすべての項目にある', () => {
    for (const kind of TEMPLATE_KIND_DEFS) {
      const scopes = scopesOfKind(kind);
      const sample = sampleValues(scopes);
      expect(placeholdersFor(scopes).filter((def) => !sample[def.name])).toEqual([]);
    }
  });
});

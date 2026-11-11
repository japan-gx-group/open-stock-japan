import { describe, expect, it } from 'vitest';
import { matchFiscalYear, matchShareClass, matchStakeholder, matchTitle, normalizeEntityName, normalizeShareClassName, normalizeTitle } from '../matching';

const stakeholders = [
  { id: 's1', label: '創業 太郎' },
  { id: 's2', label: '架空1号投資事業有限責任組合' },
  { id: 's3', label: '架空事業会社株式会社' },
  { id: 's4', label: '株式会社架空ホールディングス' },
];

describe('normalizeEntityName', () => {
  it('空白・全角と半角・法人の種類の略記を揃える', () => {
    expect(normalizeEntityName('創業　太郎')).toBe(normalizeEntityName('創業 太郎'));
    expect(normalizeEntityName('㈱架空')).toBe('株式会社架空');
    expect(normalizeEntityName('（株）架空')).toBe('株式会社架空');
    expect(normalizeEntityName('(株) 架空')).toBe('株式会社架空');
    expect(normalizeEntityName('ＡＢＣ　Ｃａｐｉｔａｌ')).toBe('abccapital');
    expect(normalizeEntityName('ｶｸｳ')).toBe('カクウ');
    expect(normalizeEntityName('架空 太郎 様')).toBe('架空太郎');
  });
});

describe('matchStakeholder', () => {
  it('表記のゆれを越えて 1 件に一致すれば exact', () => {
    expect(matchStakeholder('創業　太郎', stakeholders)).toMatchObject({ status: 'exact', id: 's1' });
    expect(matchStakeholder('架空１号投資事業有限責任組合', stakeholders)).toMatchObject({ status: 'exact', id: 's2' });
    expect(matchStakeholder('㈱架空ホールディングス', stakeholders)).toMatchObject({ status: 'exact', id: 's4' });
    expect(matchStakeholder('（株）架空ホールディングス', stakeholders)).toMatchObject({ status: 'exact', id: 's4' });
  });

  it('法人の種類の位置が違う・片方がもう片方を含むときは候補（自動では結びつけない）', () => {
    const moved = matchStakeholder('株式会社架空事業会社', stakeholders);
    expect(moved.status).toBe('candidates');
    expect(moved.id).toBeNull();
    expect(moved.candidates.map((row) => row.id)).toEqual(['s3']);
    expect(matchStakeholder('架空ホールディングス', stakeholders).candidates.map((row) => row.id)).toEqual(['s4']);
  });

  it('見つからなければ none。空・null も none', () => {
    expect(matchStakeholder('架空みらい2号投資事業有限責任組合', stakeholders).status).toBe('none');
    expect(matchStakeholder('', stakeholders).status).toBe('none');
    expect(matchStakeholder(null, stakeholders).status).toBe('none');
    expect(matchStakeholder('株式会社', stakeholders).status).toBe('none');
  });

  it('短い名前の部分一致は候補にしない', () => {
    expect(matchStakeholder('太郎', stakeholders).status).toBe('none');
  });

  it('同じ名前が複数登録されていれば、候補として人に選ばせる', () => {
    const rows = [...stakeholders, { id: 's9', label: '創業太郎' }];
    const match = matchStakeholder('創業 太郎', rows);
    expect(match.status).toBe('candidates');
    expect(match.id).toBeNull();
    expect(match.candidates.map((row) => row.id)).toEqual(['s1', 's9']);
  });
});

describe('matchShareClass', () => {
  const classes = [
    { id: 'c1', label: '普通株式' },
    { id: 'c2', label: 'A種優先株式' },
  ];
  it('「株式」「株」の有無・全角と半角・大文字と小文字を揃える', () => {
    expect(normalizeShareClassName('Ａ種優先株')).toBe(normalizeShareClassName('a種 優先株式'));
    expect(matchShareClass('普通株', classes)).toMatchObject({ status: 'exact', id: 'c1' });
    expect(matchShareClass('Ａ種優先株式', classes)).toMatchObject({ status: 'exact', id: 'c2' });
    expect(matchShareClass('B種優先株式', classes).status).toBe('none');
    expect(matchShareClass('A種優先株式（第1回）', classes).status).toBe('candidates');
  });
});

describe('matchTitle', () => {
  const plans = [
    { id: 'p1', label: '第1回新株予約権' },
    { id: 'p2', label: '第12回 新株予約権' },
  ];
  it('回次の漢数字・全角数字・空白を揃える', () => {
    expect(normalizeTitle('第一回 新株予約権')).toBe('第1回新株予約権');
    expect(normalizeTitle('第十二回新株予約権')).toBe('第12回新株予約権');
    expect(normalizeTitle('第二十回新株予約権')).toBe('第20回新株予約権');
    expect(matchTitle('第１回新株予約権', plans)).toMatchObject({ status: 'exact', id: 'p1' });
    expect(matchTitle('第一回新株予約権', plans)).toMatchObject({ status: 'exact', id: 'p1' });
    expect(matchTitle('第十二回新株予約権', plans)).toMatchObject({ status: 'exact', id: 'p2' });
    expect(matchTitle('第3回新株予約権', plans).status).toBe('none');
  });
});

describe('matchFiscalYear', () => {
  const years = [
    { id: 'y4', label: '第4期', startDate: '2026-04-01', endDate: '2027-03-31' },
    { id: 'y3', label: '第3期', startDate: '2025-04-01', endDate: '2026-03-31' },
  ];
  it('期間が一致すれば exact、期末がその年度に入っていれば候補', () => {
    expect(matchFiscalYear('2025-04-01', '2026-03-31', years)).toMatchObject({ status: 'exact', id: 'y3' });
    expect(matchFiscalYear(null, '2026-03-31', years)).toMatchObject({ status: 'exact', id: 'y3' });
    const half = matchFiscalYear('2026-04-01', '2026-09-30', years);
    expect(half.status).toBe('candidates');
    expect(half.candidates[0].id).toBe('y4');
    expect(matchFiscalYear('2020-04-01', '2021-03-31', years).status).toBe('none');
    expect(matchFiscalYear('2025-04-01', null, years).status).toBe('none');
  });
});

import { describe, expect, it } from 'vitest';
import { GROUP_SPECS, reviewFieldsOf } from '../groups';
import { normalizeFieldValue, parseStoredExtraction, toDateValue, toLineText, validateExtraction } from '../validate';
import { investmentExtraction } from './fixture';

const field = (group: keyof typeof GROUP_SPECS, key: string, kind: Parameters<typeof validateExtraction>[0] = 'investment_agreement') => {
  // 項目の定義はリソース定義から引く
  const found = reviewFieldsOf(GROUP_SPECS[group], kind).find((item) => item.key === key);
  if (!found) throw new Error(`${group}.${key} がありません`);
  return found;
};

describe('normalizeFieldValue', () => {
  it('日付は暦にある日だけを通す', () => {
    expect(toDateValue('2026-12-15')).toBe('2026-12-15');
    expect(toDateValue('2026-02-30')).toBeNull();
    expect(toDateValue('令和8年12月15日')).toBeNull();
    expect(toDateValue('0026-12-15')).toBeNull();
    expect(toDateValue(20261215)).toBeNull();
  });

  it('株式数は整数だけ。小数・0・範囲の外は null', () => {
    const shares = field('shareTransactions', 'shares');
    expect(normalizeFieldValue(shares, 1500)).toBe(1500);
    expect(normalizeFieldValue(shares, '1,500株')).toBe(1500);
    expect(normalizeFieldValue(shares, 1500.5)).toBeNull();
    expect(normalizeFieldValue(shares, 0)).toBeNull();
    expect(normalizeFieldValue(shares, 1e15)).toBeNull();
    expect(normalizeFieldValue(shares, Number.NaN)).toBeNull();
    expect(normalizeFieldValue(shares, '多数')).toBeNull();
  });

  it('金額は円未満を丸め、負の金額（定義で 0 以上）は null', () => {
    const amount = field('shareTransactions', 'amount');
    expect(normalizeFieldValue(amount, 60_000_000)).toBe(60_000_000);
    expect(normalizeFieldValue(amount, '6,000万円')).toBe(60_000_000);
    expect(normalizeFieldValue(amount, 100.4)).toBe(100);
    expect(normalizeFieldValue(amount, -1)).toBeNull();
    // 決算の利益は負を許す
    expect(normalizeFieldValue(field('financialReport', 'netIncome', 'financial_statements'), -13_220_000)).toBe(-13_220_000);
  });

  it('率は 0〜上限の % だけ', () => {
    const rate = field('convertibleRound', 'discountRate', 'convertible');
    expect(normalizeFieldValue(rate, 20)).toBe(20);
    expect(normalizeFieldValue(rate, 120)).toBeNull();
    expect(normalizeFieldValue(rate, -5)).toBeNull();
  });

  it('選択肢は定義にある値だけ。真偽は boolean だけ', () => {
    expect(normalizeFieldValue(field('stakeholders', 'kind'), 'fund')).toBe('fund');
    expect(normalizeFieldValue(field('stakeholders', 'kind'), 'vc')).toBeNull();
    expect(normalizeFieldValue(field('company', 'fiscalYearStartMonth', 'articles'), 4)).toBe('4');
    expect(normalizeFieldValue(field('company', 'hasAuditor', 'articles'), true)).toBe(true);
    expect(normalizeFieldValue(field('company', 'hasAuditor', 'articles'), 'true')).toBeNull();
  });

  it('文字は制御文字を落として長さを切る。表記（全角の空白）は残す', () => {
    expect(toLineText('  山田　太郎\n', 200)).toBe('山田　太郎');
    expect(toLineText('a\u0000b', 200)).toBe('a b');
    expect(toLineText('あ'.repeat(300), 200)).toHaveLength(200);
    expect(toLineText('   ', 200)).toBeNull();
    expect(normalizeFieldValue(field('shareClasses', 'terms'), '一\r\n二\n\n\n\n三')).toBe('一\n二\n\n三');
    expect(normalizeFieldValue(field('meeting', 'startTime', 'meeting_minutes'), '10:00')).toBe('10:00');
    expect(normalizeFieldValue(field('meeting', 'startTime', 'meeting_minutes'), '午前10時')).toBeNull();
  });
});

const raw = () => {
  const { groups, ...rest } = investmentExtraction();
  return { ...rest, ...groups, fundingRound: groups.fundingRound?.[0] } as Record<string, unknown>;
};

describe('validateExtraction', () => {
  const validate = validateExtraction('investment_agreement');

  it('正しい出力を、まとまりごとの配列にして返す', () => {
    const result = validate(raw());
    expect(result?.documentKind).toBe('investment_agreement');
    expect(result?.groups.fundingRound).toHaveLength(1);
    expect(result?.groups.fundingRound?.[0]).toMatchObject({ name: 'シリーズB', shareClassName: 'B種優先株式', targetAmount: 100_000_000 });
    expect(result?.groups.shareTransactions).toHaveLength(3);
    expect(result?.groups.stakeholders?.[0]).toMatchObject({ name: '架空1号投資事業有限責任組合', kind: 'fund' });
    expect(result?.documentDate).toBe('2026-11-25');
  });

  it('いちばん外側の形が使えないときだけ null', () => {
    expect(validate(null)).toBeNull();
    expect(validate('text')).toBeNull();
    expect(validate([])).toBeNull();
    expect(validate({ summary: 'x' })).toBeNull();
    expect(validate({ summary: 'x', shareTransactions: 'なし', warnings: 'x' })).not.toBeNull();
  });

  it('形の違う値は null に落とし、定義に無いキーは捨てる', () => {
    const input = raw();
    input.shareTransactions = [
      { holderName: '架空 太郎', shareClassName: 12, transactionDate: '2026-13-01', shares: '500', pricePerShare: 'abc', amount: -5, capitalAmount: null, stakeholderId: 'x', __proto__: { a: 1 } },
    ];
    const item = validate(input)?.groups.shareTransactions?.[0];
    expect(item).toEqual({ holderName: '架空 太郎', shareClassName: null, transactionDate: null, shares: 500, pricePerShare: null, amount: null, capitalAmount: null });
  });

  it('要る項目（株主の名前）が読めなかった件は捨てて、注意に残す', () => {
    const input = raw();
    input.shareTransactions = [{ holderName: null, shares: 100 }, { holderName: '架空 太郎', shares: 100 }, 'x', null];
    const result = validate(input);
    expect(result?.groups.shareTransactions).toHaveLength(1);
    expect(result?.warnings.join()).toContain('3 件は、必要な項目が読み取れなかったため除きました');
  });

  it('件数の上限を超えた分は切り、注意に残す', () => {
    const input = raw();
    input.shareTransactions = Array.from({ length: 130 }, (_, index) => ({ holderName: `株主${index}`, shares: 1 }));
    const result = validate(input);
    expect(result?.groups.shareTransactions).toHaveLength(GROUP_SPECS.shareTransactions.maxItems);
    expect(result?.warnings.join()).toContain('100 件を超えた');
  });

  it('同じ名前の株主は 1 件にまとめ、欠けた項目を補う', () => {
    const input = raw();
    input.stakeholders = [
      { name: '架空 太郎', address: null, kind: 'individual' },
      { name: '架空　太郎', address: '東京都', kind: null },
    ];
    const result = validate(input);
    expect(result?.groups.stakeholders).toHaveLength(1);
    expect(result?.groups.stakeholders?.[0]).toMatchObject({ name: '架空 太郎', address: '東京都', kind: 'individual' });
  });

  it('1 件のまとまりが空（すべて null）なら提案にしない', () => {
    const input = raw();
    input.fundingRound = { name: null, targetAmount: null };
    expect(validate(input)?.groups.fundingRound).toEqual([]);
    input.fundingRound = [{ name: 'x' }];
    expect(validate(input)?.groups.fundingRound).toEqual([]);
  });

  it('注意は文字だけ・件数と長さに上限', () => {
    const input = raw();
    input.warnings = [1, 'あ'.repeat(1000), ...Array.from({ length: 30 }, (_, index) => `注意${index}`)];
    const result = validate(input);
    expect(result?.warnings.length).toBeLessThanOrEqual(12);
    expect(result?.warnings[0]).toHaveLength(300);
  });

  it('何も読めなかったときは、その旨を注意に入れる', () => {
    const result = validate({ summary: '', documentDate: null, stakeholders: [], shareClasses: [], fundingRound: {}, shareTransactions: [], warnings: [] });
    expect(result?.warnings.join()).toContain('読み取れる項目がありませんでした');
  });
});

describe('parseStoredExtraction', () => {
  it('保存した結果を読み直せる（検証を通し直す）', () => {
    const stored = { ...investmentExtraction(), warnings: ['確かめてください'] };
    const parsed = parseStoredExtraction(JSON.parse(JSON.stringify(stored)));
    expect(parsed?.groups.shareTransactions).toHaveLength(3);
    expect(parsed?.groups.fundingRound?.[0]).toMatchObject({ name: 'シリーズB' });
    expect(parsed?.warnings).toEqual(['確かめてください']);
  });

  it('壊れた結果・知らない種類は null', () => {
    expect(parseStoredExtraction(null)).toBeNull();
    expect(parseStoredExtraction({ documentKind: 'unknown', groups: {} })).toBeNull();
    expect(parseStoredExtraction({ documentKind: 'articles' })).toBeNull();
  });

  it('保存された値が書き換えられていても、検証で落とす', () => {
    const stored = JSON.parse(JSON.stringify(investmentExtraction()));
    stored.groups.shareTransactions[0].shares = '<script>';
    stored.groups.shareTransactions[0].evil = 'x';
    const item = parseStoredExtraction(stored)?.groups.shareTransactions?.[0];
    expect(item?.shares).toBeNull();
    expect(item && 'evil' in item).toBe(false);
  });
});

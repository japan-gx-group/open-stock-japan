import { describe, expect, it } from 'vitest';
import { applyBlankReplacements, countBlanks } from '../convert';
import type { PlaceholderScope } from '../placeholders';

// 契約書（投資家 1 名ずつ）で使える出どころ
const SCOPES: PlaceholderScope[] = ['company', 'convertible_round', 'investment'];

// 架空のひな形（J-KISS の文面ではない）。このファイルの文面は、どれもテストのために書いたもの。
// 公開されているひな形の文面を、テストに写さないこと（記入箇所の名前 [発行会社名称] などの短い語だけを使う）。
const SOURCE = [
  '投資契約書',
  '',
  '●●株式会社（以下「発行会社」という。）と●●（以下「投資家」という。）は、●年●月●日付で、次のとおり合意する。',
  '第1条 投資家は、金●円を払い込む。',
  '第2条 評価上限額は、金●円とする。',
  '第3条 次回の資金調達の額が［1億円］以上のとき、転換価額は発行価額に［0.8］を乗じた額とする。',
  '第4条 転換期限は、●年●月●日とする。',
].join('\n');

describe('applyBlankReplacements', () => {
  it('空欄だけを差し込み項目に置き換える（空欄以外の文字は、もとの文面のまま）', () => {
    const result = applyBlankReplacements(
      SOURCE,
      [
        { find: '投資家は、金●円を払い込む', replace: '投資家は、金{{投資額}}円を払い込む' },
        { find: '評価上限額は、金●円とする', replace: '評価上限額は、金{{評価上限額}}円とする' },
      ],
      SCOPES,
    );
    expect(result.skipped).toEqual([]);
    expect(result.applied.map((item) => item.names)).toEqual([['投資額'], ['評価上限額']]);
    expect(result.applied.map((item) => item.count)).toEqual([1, 1]);
    expect(result.body).toContain('第1条 投資家は、金{{投資額}}円を払い込む。');
    expect(result.body).toContain('第2条 評価上限額は、金{{評価上限額}}円とする。');
    // 置き換えたところ以外は、1 文字も変わらない
    expect(result.body.replace('{{投資額}}', '●').replace('{{評価上限額}}', '●')).toBe(SOURCE);
  });

  it('日付の空欄（●年●月●日）は、日付の差し込み項目 1 つに置き換える', () => {
    const result = applyBlankReplacements(SOURCE, [{ find: '転換期限は、●年●月●日とする', replace: '転換期限は、{{転換期限}}とする' }], SCOPES);
    expect(result.skipped).toEqual([]);
    expect(result.body).toContain('第4条 転換期限は、{{転換期限}}とする。');
  });

  it('日付の空欄に、日付でない差し込み項目は入れない', () => {
    const result = applyBlankReplacements(SOURCE, [{ find: '転換期限は、●年●月●日とする', replace: '転換期限は、{{投資額}}とする' }], SCOPES);
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('空欄以外の文字が変わる');
    expect(result.body).toBe(SOURCE);
  });

  it('角かっこの初期値は、かっこごと置き換える。かっこの中の単位は、文面に残す', () => {
    const result = applyBlankReplacements(
      SOURCE,
      [
        { find: '資金調達の額が［1億円］以上のとき', replace: '資金調達の額が{{適格資金調達の金額}}円以上のとき' },
        { find: '発行価額に［0.8］を乗じた額', replace: '発行価額に{{転換価額の乗率}}を乗じた額' },
      ],
      SCOPES,
    );
    expect(result.skipped).toEqual([]);
    expect(result.body).toContain('第3条 次回の資金調達の額が{{適格資金調達の金額}}円以上のとき、転換価額は発行価額に{{転換価額の乗率}}を乗じた額とする。');
  });

  it('会社の名前の空欄は、「株式会社」ごと置き換えられる', () => {
    const result = applyBlankReplacements(SOURCE, [{ find: '●●株式会社（以下「発行会社」という。）', replace: '{{会社名}}（以下「発行会社」という。）' }], SCOPES);
    expect(result.skipped).toEqual([]);
    expect(result.body).toContain('{{会社名}}（以下「発行会社」という。）と●●（以下「投資家」という。）');
  });

  it('空欄以外の文字を変える案は使わない（文面を書き換えさせない）', () => {
    const result = applyBlankReplacements(
      SOURCE,
      [
        { find: '投資家は、金●円を払い込む', replace: '投資家は、金{{投資額}}円を直ちに払い込む' },
        { find: '評価上限額は、金●円とする', replace: '評価上限額は、{{評価上限額}}とする' },
        { find: '次のとおり合意する', replace: '次のとおり{{会社名}}は合意する' },
      ],
      SCOPES,
    );
    expect(result.applied).toEqual([]);
    expect(result.skipped).toHaveLength(3);
    expect(result.body).toBe(SOURCE);
  });

  it('差し込み項目を 1 つも含まない案（文面の書き換えだけ）は使わない', () => {
    const result = applyBlankReplacements(SOURCE, [{ find: '投資家は、金●円を払い込む', replace: '投資家は、金●円を払い込む' }], SCOPES);
    expect(result.applied).toEqual([]);
    expect(result.body).toBe(SOURCE);
  });

  it('文面に無い文字・複数ある文字は、どこを置き換えるか決められないので使わない', () => {
    const result = applyBlankReplacements(
      SOURCE,
      [
        { find: '金●円を支払う', replace: '金{{投資額}}円を支払う' },
        { find: '金●円', replace: '金{{投資額}}円' },
      ],
      SCOPES,
    );
    expect(result.applied).toEqual([]);
    expect(result.skipped.map((item) => item.reason)).toEqual([
      '文面の中に見つかりません（すでに置き換えた箇所か、文面と違う文字です）',
      '同じ文字が文面に複数あり、どこを置き換えるか決められません',
    ]);
  });

  it('この種類のテンプレートでは使えない差し込み項目・一覧に無い名前は使わない', () => {
    const result = applyBlankReplacements(
      SOURCE,
      [
        { find: '投資家は、金●円を払い込む', replace: '投資家は、金{{議決権の総数}}円を払い込む' },
        { find: '評価上限額は、金●円とする', replace: '評価上限額は、金{{キャップ}}円とする' },
      ],
      SCOPES,
    );
    expect(result.applied).toEqual([]);
    expect(result.skipped[0].reason).toContain('議決権の総数');
    expect(result.skipped[1].reason).toContain('キャップ');
  });

  it('AI が空白や空欄の記号の個数を写し違えていても、もとの文面の文字を保って置き換える', () => {
    const source = '発行会社：  ●●●株式会社\n払込金額：金 ● 円';
    const result = applyBlankReplacements(
      source,
      [
        { find: '発行会社：●●株式会社', replace: '発行会社：{{会社名}}' },
        { find: '払込金額：金●円', replace: '払込金額：金{{投資額}}円' },
      ],
      SCOPES,
    );
    expect(result.skipped).toEqual([]);
    expect(result.body).toBe('発行会社：  {{会社名}}\n払込金額：金 {{投資額}} 円');
  });

  it('1 つの案の中の空欄の一部だけを置き換えてもよい（残りは空欄のまま）', () => {
    const result = applyBlankReplacements(
      SOURCE,
      [{ find: '●●株式会社（以下「発行会社」という。）と●●（以下「投資家」という。）', replace: '{{会社名}}（以下「発行会社」という。）と●●（以下「投資家」という。）' }],
      SCOPES,
    );
    expect(result.skipped).toEqual([]);
    expect(result.body).toContain('{{会社名}}（以下「発行会社」という。）と●●（以下「投資家」という。）は、');
  });

  it('同じ空欄を 2 回置き換える案は、2 回目を使わない', () => {
    const replacement = { find: '投資家は、金●円を払い込む', replace: '投資家は、金{{投資額}}円を払い込む' };
    const result = applyBlankReplacements(SOURCE, [replacement, replacement], SCOPES);
    expect(result.applied).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
  });

  it('記入箇所の名前が入った角かっこは、かっこごと置き換える', () => {
    const source = '[発行会社名称]（以下「発行会社」という。）と[投資家名]（以下「投資家」という。）は、合意する。';
    const result = applyBlankReplacements(
      source,
      [
        { find: '[発行会社名称]（以下「発行会社」という。）', replace: '{{会社名}}（以下「発行会社」という。）' },
        { find: 'と[投資家名]（以下「投資家」という。）', replace: 'と{{投資家名}}（以下「投資家」という。）' },
      ],
      SCOPES,
    );
    expect(result.skipped).toEqual([]);
    expect(result.body).toBe('{{会社名}}（以下「発行会社」という。）と{{投資家名}}（以下「投資家」という。）は、合意する。');
  });

  it('find が角かっこ 1 つだけのときは、同じ角かっこのすべてを置き換える', () => {
    const source = '[発行会社名称]\n契約書\n[発行会社名称]（以下「発行会社」という。）\n署名: [発行会社名称]';
    const result = applyBlankReplacements(source, [{ find: '[発行会社名称]', replace: '{{会社名}}' }], SCOPES);
    expect(result.skipped).toEqual([]);
    expect(result.applied).toEqual([{ before: '[発行会社名称]', after: '{{会社名}}', names: ['会社名'], count: 3 }]);
    expect(result.body).toBe('{{会社名}}\n契約書\n{{会社名}}（以下「発行会社」という。）\n署名: {{会社名}}');
  });

  it('[●] や数字の角かっこは、場所ごとに入るものが違うので、まとめては置き換えない', () => {
    const source = '新株予約権 [●]個、合計[●]円。第[1]回、[1]個あたり。';
    const result = applyBlankReplacements(
      source,
      [
        { find: '[●]', replace: '{{投資額}}' },
        { find: '[1]', replace: '{{投資家の数}}' },
        { find: '合計[●]円', replace: '合計{{投資額}}円' },
      ],
      SCOPES,
    );
    expect(result.skipped.map((item) => item.find)).toEqual(['[●]', '[1]']);
    expect(result.body).toBe('新株予約権 [●]個、合計{{投資額}}円。第[1]回、[1]個あたり。');
  });

  it('角かっこに入った文（注記）は、空欄として扱わない', () => {
    const source = '[なお、本契約は、公開されているひな形から変更されていない。]\n[発行会社名称]';
    const result = applyBlankReplacements(
      source,
      [{ find: '[なお、本契約は、公開されているひな形から変更されていない。]', replace: '{{会社名}}' }],
      SCOPES,
    );
    expect(result.applied).toEqual([]);
    expect(result.body).toBe(source);
  });

  it('下線と「20＿年＿月＿日」の形の空欄も置き換える', () => {
    const source = '(y) ＿＿＿＿＿円\n20＿年＿月＿日';
    const result = applyBlankReplacements(
      source,
      [
        { find: '(y) ＿＿＿＿＿円', replace: '(y) {{評価上限額}}円' },
        { find: '20＿年＿月＿日', replace: '{{発行日（西暦）}}' },
      ],
      SCOPES,
    );
    expect(result.skipped).toEqual([]);
    expect(result.body).toBe('(y) {{評価上限額}}円\n{{発行日（西暦）}}');
  });

  it('残っている空欄の数を返す', () => {
    const result = applyBlankReplacements(SOURCE, [{ find: '転換期限は、●年●月●日とする', replace: '転換期限は、{{転換期限}}とする' }], SCOPES);
    // ●●株式会社・●●（投資家）・●年●月●日（合意の日）・金●円 × 2
    expect(result.remainingBlanks).toBe(5);
  });
});

describe('countBlanks', () => {
  it('空欄の並びと日付の空欄を、1 か所ずつ数える', () => {
    expect(countBlanks('●●株式会社は、●年●月●日に金●円を払う。＿＿＿＿')).toBe(4);
  });

  it('語としての「年月日」や、数字の入った角かっこ（初期値）は数えない', () => {
    expect(countBlanks('生年月日を記入する。［1億円］以上。第[1]回。2026年6月26日')).toBe(0);
  });

  it('記入箇所の名前が入った角かっこは数える。置き換えたあとの差し込み項目は数えない', () => {
    expect(countBlanks('[発行会社名称]と[投資家名]、合計[●]円。{{会社名}}')).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { analyzeTemplate, extractPlaceholders, fillTemplate, replaceUnusablePlaceholders, segmentBody } from '../fill';
import { countNeedsReview } from '../placeholders';

describe('extractPlaceholders', () => {
  it('出てきた順に、重複なく取り出す（前後の空白と、全角の波かっこも受け付ける）', () => {
    expect(extractPlaceholders('{{会社名}}は、{{ 開催日 }}に｛｛会議の名称｝｝を開く。{{会社名}}')).toEqual(['会社名', '開催日', '会議の名称']);
  });

  it('波かっこが 1 つだけのもの・名前が空のもの・改行をまたぐものは、差し込み項目ではない', () => {
    expect(extractPlaceholders('{会社名} と {{}} と {{会社\n名}}')).toEqual([]);
  });
});

describe('analyzeTemplate', () => {
  it('その種類で使える名前・一覧に無い名前・この種類では値を入れられない名前に分ける', () => {
    const analysis = analyzeTemplate('{{会社名}} {{開催日}} {{投資額}} {{合言葉}}', ['company', 'meeting', 'shareholder_meeting']);
    expect(analysis.used.map((def) => def.name)).toEqual(['会社名', '開催日']);
    expect(analysis.outOfScope).toEqual(['投資額']);
    expect(analysis.unknown).toEqual(['合言葉']);
  });
});

describe('fillTemplate', () => {
  it('差し込み項目を値に置き換える（同じ項目が何度出てきても）', () => {
    const result = fillTemplate('{{会社名}}（以下「当社」）。発信者: {{会社名}}', { 会社名: '株式会社サンプル' });
    expect(result.text).toBe('株式会社サンプル（以下「当社」）。発信者: 株式会社サンプル');
    expect(result.missing).toEqual([]);
    expect(result.unknown).toEqual([]);
  });

  it('値が無い項目は【要確認】にして、何が埋まらなかったかを返す', () => {
    const result = fillTemplate('場所: {{開催場所}}\n議長: {{議長}}', { 開催場所: null, 議長: '  ' });
    expect(result.text).toBe('場所: 【要確認: 開催場所】\n議長: 【要確認: 議長】');
    expect(result.missing).toEqual(['開催場所', '議長']);
    expect(countNeedsReview(result.text)).toBe(2);
  });

  it('値の一覧に無い名前は unknown として返す（台帳に値が無いのとは区別する）', () => {
    const result = fillTemplate('{{会社名}}の{{合言葉}}', { 会社名: 'A社' });
    expect(result.text).toBe('A社の【要確認: 合言葉】');
    expect(result.unknown).toEqual(['合言葉']);
    expect(result.missing).toEqual([]);
  });

  it('値の中の {{ }} や $ は、もう一度置き換えたり、特別な文字として扱ったりしない', () => {
    const result = fillTemplate('{{議長}}', { 議長: '{{会社名}} $& $1', 会社名: 'A社' });
    expect(result.text).toBe('{{会社名}} $& $1');
  });

  it('プロトタイプの名前（constructor など）を、値として拾わない', () => {
    expect(fillTemplate('{{constructor}}', {}).text).toBe('【要確認: constructor】');
  });
});

describe('replaceUnusablePlaceholders', () => {
  it('使えない名前だけを【要確認】に書き換え、使える名前は {{名前}} の形にそろえる', () => {
    const result = replaceUnusablePlaceholders('{{ 会社名 }}は{{割当株式数}}を{{投資額}}で', ['company', 'meeting']);
    expect(result.body).toBe('{{会社名}}は【要確認: 割当株式数】を【要確認: 投資額】で');
    expect(result.replaced).toEqual(['割当株式数', '投資額']);
  });
});

describe('segmentBody', () => {
  it('地の文・差し込み項目・【要確認】に分ける', () => {
    expect(segmentBody('日時: {{開催日時}}\n場所: 【要確認: 部屋】 {{合言葉}}', ['meeting'])).toEqual([
      { type: 'text', text: '日時: ' },
      { type: 'placeholder', name: '開催日時', known: true },
      { type: 'text', text: '\n場所: ' },
      { type: 'review', text: '【要確認: 部屋】' },
      { type: 'text', text: ' ' },
      { type: 'placeholder', name: '合言葉', known: false },
    ]);
  });
});

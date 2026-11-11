import { describe, expect, it } from 'vitest';
import { parseUpdateBody, updateExcerpt } from '../updateBody';

describe('parseUpdateBody', () => {
  it('見出し・箇条書き・段落に分ける', () => {
    expect(parseUpdateBody('# 題\n\n本文1\n本文2\n\n- a\n- b\n続き\n## 小見出し')).toEqual([
      { type: 'heading', level: 1, text: '題' },
      { type: 'paragraph', lines: ['本文1', '本文2'] },
      { type: 'list', items: ['a', 'b'] },
      { type: 'paragraph', lines: ['続き'] },
      { type: 'heading', level: 2, text: '小見出し' },
    ]);
  });
  it('段落の直後の箇条書きも分ける。CRLF を扱う', () => {
    expect(parseUpdateBody('要点:\r\n- a\r\n- b')).toEqual([
      { type: 'paragraph', lines: ['要点:'] },
      { type: 'list', items: ['a', 'b'] },
    ]);
  });
  it('空白の無い # や - は文字として扱う', () => {
    expect(parseUpdateBody('#タグ\n-10%')).toEqual([{ type: 'paragraph', lines: ['#タグ', '-10%'] }]);
  });
  it('HTML は解釈せず文字のまま残す', () => {
    const blocks = parseUpdateBody('<script>alert(1)</script>\n- <img src=x onerror=alert(1)>');
    expect(blocks).toEqual([
      { type: 'paragraph', lines: ['<script>alert(1)</script>'] },
      { type: 'list', items: ['<img src=x onerror=alert(1)>'] },
    ]);
  });
  it('空・null は空の配列', () => {
    expect(parseUpdateBody('')).toEqual([]);
    expect(parseUpdateBody(null)).toEqual([]);
    expect(parseUpdateBody('\n \n')).toEqual([]);
  });
});

describe('updateExcerpt', () => {
  it('見出しを除いた文章を短くする', () => {
    expect(updateExcerpt('# 題\n\n株主のみなさまへ\n\n- 売上\n- 利益')).toBe('株主のみなさまへ 売上、利益');
    expect(updateExcerpt('あ'.repeat(200), 10)).toBe(`${'あ'.repeat(10)}…`);
  });
});

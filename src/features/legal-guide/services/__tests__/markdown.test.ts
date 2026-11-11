import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LEGAL_DOC_PATHS, LEGAL_DOCS, findLegalDoc } from '../docs';
import { inlineText, parseInline, parseMarkdown, resolveLink, splitTableRow, type Block } from '../markdown';

describe('parseInline', () => {
  it('太字・コード・リンク・素の URL を分ける', () => {
    expect(parseInline('前 **太字と `code`** 後 [会社法](https://example.com/a) https://example.com/b。')).toEqual([
      { type: 'text', text: '前 ' },
      { type: 'strong', children: [{ type: 'text', text: '太字と ' }, { type: 'code', text: 'code' }] },
      { type: 'text', text: ' 後 ' },
      { type: 'link', href: 'https://example.com/a', children: [{ type: 'text', text: '会社法' }] },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://example.com/b', children: [{ type: 'text', text: 'https://example.com/b' }] },
      { type: 'text', text: '。' },
    ]);
  });

  it('コードの中身は解釈しない', () => {
    expect(parseInline('`**a** [b](c)`')).toEqual([{ type: 'code', text: '**a** [b](c)' }]);
  });

  it('閉じていない記号と HTML はそのまま文字にする', () => {
    expect(parseInline('**閉じない <script>alert(1)</script> `x')).toEqual([{ type: 'text', text: '**閉じない <script>alert(1)</script> `x' }]);
  });

  it('エスケープした記号は文字にする', () => {
    expect(inlineText(parseInline('\\*\\*太字ではない\\*\\* a\\|b'))).toBe('**太字ではない** a|b');
  });
});

describe('parseMarkdown', () => {
  it('見出し・段落・引用・水平線', () => {
    const blocks = parseMarkdown('# 題\n\n> **免責**: 注意\n> 2 行目\n\n本文 1\n本文 2\n\n---\n\n### 小見出し ###\n');
    expect(blocks.map((block) => block.type)).toEqual(['heading', 'blockquote', 'paragraph', 'rule', 'heading']);
    expect(blocks[0]).toMatchObject({ level: 1, inline: [{ type: 'text', text: '題' }] });
    expect(blocks[1]).toMatchObject({ blocks: [{ type: 'paragraph' }] });
    expect(blocks[2]).toMatchObject({ inline: [{ type: 'text', text: '本文 1\n本文 2' }] });
    expect(blocks[4]).toMatchObject({ level: 3, inline: [{ type: 'text', text: '小見出し' }] });
  });

  it('箇条書きと、入れ子の番号つきリスト', () => {
    const [list, after] = parseMarkdown('- 親 A\n  1. 子 1\n  2. 子 2\n- 親 B\n  続きの行\n\n段落') as Block[];
    expect(list).toMatchObject({ type: 'list', ordered: false });
    if (list.type !== 'list') throw new Error('list');
    expect(list.items).toHaveLength(2);
    expect(inlineText(list.items[0].inline)).toBe('親 A');
    expect(list.items[0].children).toMatchObject([{ type: 'list', ordered: true, start: 1, items: [{}, {}] }]);
    expect(inlineText(list.items[1].inline)).toBe('親 B\n続きの行');
    expect(after).toMatchObject({ type: 'paragraph' });
  });

  it('番号つきリストは開始番号を保ち、箇条書きとは別のリストにする', () => {
    const blocks = parseMarkdown('3. 三\n4. 四\n- 点');
    expect(blocks).toMatchObject([
      { type: 'list', ordered: true, start: 3 },
      { type: 'list', ordered: false },
    ]);
  });

  it('表: 列の数を見出しにそろえ、セルの中のインラインを解釈する', () => {
    const [table] = parseMarkdown('| 項目 | 内容 | 根拠 |\n|---|:--|--:|\n| **期限** | `a|b` と c \\| d | 法299条 |\n| 欠け |\n');
    if (table.type !== 'table') throw new Error('table');
    expect(table.header.map(inlineText)).toEqual(['項目', '内容', '根拠']);
    expect(table.rows[0][0]).toEqual([{ type: 'strong', children: [{ type: 'text', text: '期限' }] }]);
    expect(inlineText(table.rows[0][1])).toBe('a|b と c | d');
    expect(table.rows[1].map(inlineText)).toEqual(['欠け', '', '']);
  });

  it('段落の直後の表・コードブロック', () => {
    const blocks = parseMarkdown('説明:\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```\n# 見出しではない\n- リストではない\n```\n');
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'table', 'code']);
    expect(blocks[2]).toEqual({ type: 'code', text: '# 見出しではない\n- リストではない' });
  });

  it('splitTableRow は前後の | を除く', () => {
    expect(splitTableRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitTableRow('a | b')).toEqual(['a', 'b']);
    expect(splitTableRow('| a |  |')).toEqual(['a', '']);
  });
});

describe('resolveLink', () => {
  it('http(s) の URL は外部リンク', () => {
    expect(resolveLink('https://laws.e-gov.go.jp/law/417AC0000000086', LEGAL_DOC_PATHS)).toEqual({
      kind: 'external',
      href: 'https://laws.e-gov.go.jp/law/417AC0000000086',
    });
    expect(resolveLink('HTTP://example.com', LEGAL_DOC_PATHS)?.kind).toBe('external');
  });

  it('一覧にある別の文書は画面内のリンク（アンカーは落とす）', () => {
    expect(resolveLink('06-financial-disclosure.md', LEGAL_DOC_PATHS)).toEqual({ kind: 'internal', href: '/legal-guide/financial-disclosure' });
    expect(resolveLink('./rules.md#d', LEGAL_DOC_PATHS)).toEqual({ kind: 'internal', href: '/legal-guide/rules' });
  });

  it('それ以外はリンクにしない', () => {
    for (const href of [
      'javascript:alert(1)',
      ' JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:x',
      '//evil.example.com',
      '/settings/company',
      '../architecture.md',
      '../../.env',
      'unknown.md',
      'mailto:a@example.com',
      'https://',
      '',
    ]) {
      expect(resolveLink(href, LEGAL_DOC_PATHS), href).toBeNull();
    }
  });
});

describe('文書の一覧', () => {
  it('slug は一覧にあるものだけを受け付ける', () => {
    expect(findLegalDoc('shareholders-meeting')?.fileName).toBe('04-shareholders-meeting.md');
    expect(findLegalDoc('../../package')).toBeNull();
    expect(findLegalDoc('04-shareholders-meeting.md')).toBeNull();
    expect(findLegalDoc('')).toBeNull();
  });

  it('ファイル名は docs/legal 直下の .md だけ（パスの区切りを含まない）', () => {
    for (const doc of LEGAL_DOCS) {
      expect(doc.fileName).toMatch(/^[a-z0-9-]+\.md$/);
      expect(doc.slug).toMatch(/^[a-z-]+$/);
    }
    expect(new Set(LEGAL_DOCS.map((doc) => doc.slug)).size).toBe(LEGAL_DOCS.length);
  });

  it('実際の文書をすべて解釈でき、最初の見出しが h1、生の表記号が段落に残らない', () => {
    for (const doc of LEGAL_DOCS) {
      const source = readFileSync(path.join(process.cwd(), 'docs', 'legal', doc.fileName), 'utf8');
      const blocks = parseMarkdown(source);
      expect(blocks[0], doc.fileName).toMatchObject({ type: 'heading', level: 1 });
      expect(blocks.some((block) => block.type === 'table'), doc.fileName).toBe(true);
      const paragraphs = blocks.filter((block) => block.type === 'paragraph').map((block) => (block.type === 'paragraph' ? inlineText(block.inline) : ''));
      expect(paragraphs.filter((text) => /^\s*\|.*\|\s*$/m.test(text) || /^#{1,6}\s/m.test(text)), doc.fileName).toEqual([]);
    }
  });
});

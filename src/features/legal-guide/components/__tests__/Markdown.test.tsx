import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { parseMarkdown } from '../../services/markdown';
import { Markdown, tableOfContents } from '../Markdown';

// next/link はルーターの文脈が要るため、テストでは素の a に置き換える
vi.mock('next/link', () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className} data-internal="true">
      {children}
    </a>
  ),
}));

const docPaths = new Map([['rules.md', '/legal-guide/rules']]);
const render = (source: string): string => renderToStaticMarkup(<Markdown blocks={parseMarkdown(source)} docPaths={docPaths} />);

describe('Markdown', () => {
  it('見出し・段落・リスト・表・コードを要素にする', () => {
    const html = render('# 題\n\n## 節\n\n本文 **太字** `code`\n\n- a\n  1. b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n');
    expect(html).toContain('<h1');
    expect(html).toMatch(/<h2 id="section-2"[^>]*>節<\/h2>/);
    expect(html).toMatch(/<strong[^>]*>太字<\/strong>/);
    expect(html).toMatch(/<code[^>]*>code<\/code>/);
    expect(html).toMatch(/<ul[^>]*><li[^>]*>a<ol[^>]*><li[^>]*>b<\/li><\/ol><\/li><\/ul>/);
    expect(html).toMatch(/<th[^>]*>x<\/th>/);
    expect(html).toMatch(/<td[^>]*>2<\/td>/);
  });

  it('表は横スクロールの枠に入れ、短い列は折り返さず、文章の列には最小の幅を持たせる', () => {
    const html = render(`| 項目 | 内容 |\n|---|---|\n| 基準日 | ${'あ'.repeat(30)} |\n`);
    expect(html).toContain('gt-table-scroll');
    expect(html).toMatch(/<th[^>]*whitespace-nowrap[^>]*>項目<\/th>/);
    expect(html).toMatch(/<td[^>]*whitespace-nowrap[^>]*>基準日<\/td>/);
    // 見出しは短いので折り返さない。セルは文章なので、折り返す代わりに最小の幅を持つ
    expect(html).toMatch(/<th[^>]*whitespace-nowrap[^>]*>内容<\/th>/);
    expect(html).toMatch(/<td[^>]*min-w-\[11em\][^>]*>あ+<\/td>/);
  });

  it('長い識別子は「_」のあとで折り返せる（表の列を広げない）', () => {
    const html = render('| rule id | 内容 |\n|---|---|\n| `registry_inspection_refusal_lookback_years` | 期間 |\n');
    expect(html).toContain('registry_<wbr/>inspection_<wbr/>refusal_<wbr/>lookback_<wbr/>years');
    expect(html).toMatch(/<td[^>]*min-w-\[13em\][^>]*><code/);
  });

  it('生の HTML は要素にならず、文字としてエスケープされる', () => {
    const html = render('<script>alert(1)</script> <img src=x onerror=alert(1)>\n\n| <b>a</b> |\n|---|\n| <i>b</i> |');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('http(s) の URL は別タブで開く外部リンクにする', () => {
    const html = render('[会社法](https://laws.e-gov.go.jp/law/417AC0000000086) と https://example.com/x');
    expect(html).toContain('<a href="https://laws.e-gov.go.jp/law/417AC0000000086" target="_blank" rel="noopener noreferrer"');
    expect(html).toContain('<a href="https://example.com/x" target="_blank" rel="noopener noreferrer"');
  });

  it('一覧にある別の文書へのリンクは画面内のリンクにする', () => {
    const html = render('[数値ルール](rules.md#d)');
    expect(html).toContain('<a href="/legal-guide/rules"');
    expect(html).toContain('data-internal="true"');
  });

  it('危険なリンク・未知のリンクはアンカーにしない（文字だけ残す）', () => {
    const html = render('[押す](javascript:alert(1)) [data](data:text/html,x) [相対](../secret.md) [外](//evil.example.com) [未知](other.md)');
    expect(html).not.toContain('<a');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('押す');
    expect(html).toContain('未知');
  });

  it('目次は h2 だけを拾う', () => {
    expect(tableOfContents(parseMarkdown('# 題\n\n## 1. 節 **A**\n\n### 小\n\n## 2. 節 `B`\n'))).toEqual([
      { id: 'section-2', text: '1. 節 A' },
      { id: 'section-4', text: '2. 節 B' },
    ]);
  });
});

// Markdown の構文木（services/markdown.ts）を React 要素にする。HTML 文字列は使わない（dangerouslySetInnerHTML なし）。
// リンクは resolveLink が認めたもの（http(s) と、一覧にある別の文書）だけをアンカーにし、それ以外は文字として出す。

import { Fragment, type ReactNode } from 'react';
import Link from 'next/link';
import { inlineText, resolveLink, type Block, type Inline } from '../services/markdown';

interface RenderOptions {
  docPaths: ReadonlyMap<string, string>;
}

const renderInline = (nodes: Inline[], options: RenderOptions, keyPrefix = 'i'): ReactNode[] =>
  nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.type) {
      case 'text':
        return node.text;
      case 'code':
        // 長い識別子（rule id など）は「_」「/」のあとで折り返せるようにする（1 語のままだと、表の列を広げてほかの列を細くするため）
        return (
          <code key={key} className="rounded bg-bg-subtle border border-border px-1 py-[1px] text-[0.92em] font-mono break-words">
            {node.text.split(/(?<=[_/])/).map((part, partIndex) => (
              <Fragment key={partIndex}>
                {partIndex > 0 && <wbr />}
                {part}
              </Fragment>
            ))}
          </code>
        );
      case 'strong':
        return (
          <strong key={key} className="font-semibold text-text-heading">
            {renderInline(node.children, options, key)}
          </strong>
        );
      case 'link': {
        const resolved = resolveLink(node.href, options.docPaths);
        const children = renderInline(node.children, options, key);
        if (!resolved) return <span key={key}>{children}</span>;
        if (resolved.kind === 'internal') {
          return (
            <Link key={key} href={resolved.href} className="text-primary underline">
              {children}
            </Link>
          );
        }
        return (
          <a key={key} href={resolved.href} target="_blank" rel="noopener noreferrer" className="text-primary underline break-all">
            {children}
          </a>
        );
      }
      default:
        return null;
    }
  });

const HEADING_CLASS: Record<number, string> = {
  1: 'text-[22px] font-bold text-text-heading mt-0 mb-4',
  2: 'text-[17px] font-bold text-text-heading mt-8 mb-3 pb-1 border-b border-border scroll-mt-4',
  3: 'text-[15px] font-semibold text-text-heading mt-6 mb-2',
  4: 'text-[14px] font-semibold text-text-heading mt-4 mb-2',
  5: 'text-[13.5px] font-semibold text-text-heading mt-4 mb-1',
  6: 'text-[13px] font-semibold text-text-muted mt-4 mb-1',
};

// ---- 表の列の幅 ----
// 列ごとに、いちばん長いセルの長さ（全角 1 文字 = 1）で折り返し方を決める（globals.css の .gt-table と同じ考え方）:
//   - 短い列（項目名・条文番号・数値など）は折り返さない（1〜2 文字ずつ縦に割れるのを防ぐ）
//   - 文章の列は折り返すが、長さに応じた最小の幅を持つ（残りの幅は、ブラウザが文章の長い列に多く配る）
//   - 識別子だけの列（rule id）は、2〜3 行に収まる幅を持つ
// 最小の幅（セルの余白を含む）は、6 列の表（数値ルール一覧）が本文の幅 約 920px に収まるように決めてある。
// 最小の幅の合計が入りきらないときだけ、表が横にスクロールする（.gt-table-scroll）。
const NOWRAP_LENGTH = 12;

/** 表示上のおおよその長さ（全角は 1、半角は 0.55 として数える） */
const visualLength = (text: string): number => {
  let length = 0;
  for (const ch of text) length += ch.charCodeAt(0) > 0x2e7f ? 1 : 0.55;
  return length;
};

const columnClass = (length: number, isIdentifier: boolean): string => {
  if (length <= NOWRAP_LENGTH) return 'whitespace-nowrap';
  if (isIdentifier) return 'min-w-[13em]';
  if (length <= 24) return 'min-w-[9em]';
  if (length <= 48) return 'min-w-[11em]';
  return 'min-w-[14em]';
};

/** コード 1 つだけのセル（識別子） */
const isCodeCell = (cell: Inline[] | undefined): boolean => cell?.length === 1 && cell[0].type === 'code';

/** 列ごとのクラス（見出し用・セル用）。短い見出しは、文章の列でも折り返さない */
const tableColumns = (header: Inline[][], rows: Inline[][][]): { head: string; cell: string }[] =>
  header.map((cell, index) => {
    const headLength = visualLength(inlineText(cell));
    const length = Math.max(headLength, ...rows.map((row) => visualLength(inlineText(row[index] ?? []))));
    const cellClass = columnClass(length, rows.length > 0 && rows.every((row) => isCodeCell(row[index])));
    return { head: headLength <= NOWRAP_LENGTH ? 'whitespace-nowrap' : cellClass, cell: cellClass };
  });

/** 見出し（h2）の id。目次のリンク先に使う */
export const headingId = (index: number): string => `section-${index + 1}`;

/** 目次（h2 の一覧） */
export const tableOfContents = (blocks: Block[]): { id: string; text: string }[] =>
  blocks.flatMap((block, index) =>
    block.type === 'heading' && block.level === 2 ? [{ id: headingId(index), text: inlineText(block.inline) }] : [],
  );

const renderBlocks = (blocks: Block[], options: RenderOptions, keyPrefix: string, topLevel: boolean): ReactNode[] =>
  blocks.map((block, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (block.type) {
      case 'heading': {
        const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
        return (
          <Tag key={key} id={topLevel && block.level === 2 ? headingId(index) : undefined} className={HEADING_CLASS[block.level]}>
            {renderInline(block.inline, options, key)}
          </Tag>
        );
      }
      case 'paragraph':
        return (
          <p key={key} className="my-3 whitespace-pre-line">
            {renderInline(block.inline, options, key)}
          </p>
        );
      case 'list': {
        const items = block.items.map((item, itemIndex) => (
          <li key={`${key}-${itemIndex}`} className="my-1">
            {renderInline(item.inline, options, `${key}-${itemIndex}`)}
            {item.children.length > 0 && renderBlocks(item.children, options, `${key}-${itemIndex}c`, false)}
          </li>
        ));
        return block.ordered ? (
          <ol key={key} start={block.start} className="my-3 pl-6 list-decimal">
            {items}
          </ol>
        ) : (
          <ul key={key} className="my-3 pl-6 list-disc">
            {items}
          </ul>
        );
      }
      case 'table': {
        const columns = tableColumns(block.header, block.rows);
        return (
          <div key={key} className="my-4 gt-table-scroll rounded-md border border-border">
            <table className="w-full border-collapse text-[13px] leading-[1.65]">
              <thead>
                <tr>
                  {block.header.map((cell, cellIndex) => (
                    <th
                      key={cellIndex}
                      scope="col"
                      className={`border-b border-border bg-bg-subtle px-3 py-2 text-left font-semibold text-text-heading align-top ${columns[cellIndex]?.head ?? ''}`}
                    >
                      {renderInline(cell, options, `${key}-h${cellIndex}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {row.map((cell, cellIndex) => (
                      <td key={cellIndex} className={`border-b border-border px-3 py-2 align-top ${columns[cellIndex]?.cell ?? ''}`}>
                        {renderInline(cell, options, `${key}-${rowIndex}-${cellIndex}`)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      case 'blockquote':
        return (
          <blockquote key={key} className="my-4 mx-0 rounded-md border border-border border-l-4 border-l-primary bg-primary-bg/40 px-4 py-1 text-[13px]">
            {renderBlocks(block.blocks, options, key, false)}
          </blockquote>
        );
      case 'code':
        return (
          <pre key={key} className="my-4 overflow-x-auto rounded-md border border-border bg-bg-subtle px-4 py-3 text-[12.5px] leading-relaxed font-mono">
            <code>{block.text}</code>
          </pre>
        );
      case 'rule':
        return <hr key={key} className="my-6 border-0 border-t border-border" />;
      default:
        return null;
    }
  });

export const Markdown = ({ blocks, docPaths }: { blocks: Block[]; docPaths: ReadonlyMap<string, string> }) => (
  <div className="text-[14px] leading-[1.85] text-text-body">{renderBlocks(blocks, { docPaths }, 'b', true)}</div>
);

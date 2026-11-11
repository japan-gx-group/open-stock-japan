// 小さな Markdown パーサ（docs/legal/ の文書を画面に出すため）。サーバ依存なし・外部ライブラリなし。
// 対応: 見出し、段落、箇条書き（入れ子）、番号つきリスト、表、引用、コードブロック、水平線、
//       インラインのコード・太字・リンク・素の URL。
// 出力は構文木（Block / Inline）。HTML 文字列は作らない（描画は components/Markdown.tsx が React 要素にする）。
// 対応していない記法（生の HTML・画像・斜体など）は、そのまま文字として出る。

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export interface ListItem {
  inline: Inline[];
  children: Block[];
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; inline: Inline[] }
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'table'; header: Inline[][]; rows: Inline[][][] }
  | { type: 'blockquote'; blocks: Block[] }
  | { type: 'code'; text: string }
  | { type: 'rule' };

// ---- インライン ----

const pushText = (out: Inline[], text: string): void => {
  if (!text) return;
  const last = out.at(-1);
  if (last?.type === 'text') last.text += text;
  else out.push({ type: 'text', text });
};

const URL_PATTERN = /^https?:\/\/[^\s<>"'`|）」』】]+/;
/** 素の URL の末尾に付いた句読点・閉じ括弧は URL に含めない */
const TRAILING_PUNCTUATION = /[.,;:!?、。)\]]+$/;

/** 対応する閉じ括弧の位置（入れ子を数える）。無ければ -1 */
const findClosing = (text: string, from: number, open: string, close: string): number => {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    const ch = text[index];
    if (ch === '\\') {
      index += 1;
    } else if (ch === open) {
      depth += 1;
    } else if (ch === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
};

export const parseInline = (source: string): Inline[] => {
  const out: Inline[] = [];
  let index = 0;
  while (index < source.length) {
    const ch = source[index];

    // エスケープ（\* \| \[ など）
    if (ch === '\\' && index + 1 < source.length && /[\\`*_{}[\]()#+\-.!|>~]/.test(source[index + 1])) {
      pushText(out, source[index + 1]);
      index += 2;
      continue;
    }

    // インラインのコード（中身は解釈しない）
    if (ch === '`') {
      const fence = /^`+/.exec(source.slice(index))?.[0] ?? '`';
      const end = source.indexOf(fence, index + fence.length);
      if (end > index) {
        out.push({ type: 'code', text: source.slice(index + fence.length, end).trim() });
        index = end + fence.length;
        continue;
      }
    }

    // 太字
    if (source.startsWith('**', index)) {
      const end = source.indexOf('**', index + 2);
      if (end > index + 2) {
        out.push({ type: 'strong', children: parseInline(source.slice(index + 2, end)) });
        index = end + 2;
        continue;
      }
    }

    // リンク [文字](URL)
    if (ch === '[') {
      const closeLabel = findClosing(source, index, '[', ']');
      if (closeLabel > index && source[closeLabel + 1] === '(') {
        const closeHref = findClosing(source, closeLabel + 1, '(', ')');
        if (closeHref > closeLabel) {
          const href = source.slice(closeLabel + 2, closeHref).trim().split(/\s+/)[0] ?? '';
          out.push({ type: 'link', href, children: parseInline(source.slice(index + 1, closeLabel)) });
          index = closeHref + 1;
          continue;
        }
      }
    }

    // 素の URL
    if (ch === 'h') {
      const match = URL_PATTERN.exec(source.slice(index));
      if (match) {
        const url = match[0].replace(TRAILING_PUNCTUATION, '');
        out.push({ type: 'link', href: url, children: [{ type: 'text', text: url }] });
        index += url.length;
        continue;
      }
    }

    pushText(out, ch);
    index += 1;
  }
  return out;
};

/** インラインの構文木を素の文字にする（見出しの目次などに使う） */
export const inlineText = (inline: Inline[]): string =>
  inline.map((node) => (node.type === 'text' || node.type === 'code' ? node.text : inlineText(node.children))).join('');

// ---- ブロック ----

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const FENCE = /^\s{0,3}(```|~~~)/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const BLOCKQUOTE = /^\s{0,3}>\s?(.*)$/;

const indentOf = (line: string): number => (/^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;

/** 表の 1 行をセルに分ける（\| とコード内の | は区切りにしない） */
export const splitTableRow = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  const trimmed = line.trim();
  for (let index = 0; index < trimmed.length; index += 1) {
    const ch = trimmed[index];
    if (ch === '\\' && trimmed[index + 1] === '|') {
      current += '|';
      index += 1;
    } else if (ch === '`') {
      inCode = !inCode;
      current += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  if (trimmed.startsWith('|')) cells.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) cells.pop();
  return cells.map((cell) => cell.trim());
};

const isTableStart = (lines: string[], index: number): boolean =>
  lines[index].includes('|') && index + 1 < lines.length && TABLE_SEPARATOR.test(lines[index + 1]) && lines[index + 1].includes('-');

const startsBlock = (lines: string[], index: number): boolean => {
  const line = lines[index];
  return HEADING.test(line) || RULE.test(line) || LIST_ITEM.test(line) || FENCE.test(line) || BLOCKQUOTE.test(line) || isTableStart(lines, index);
};

const parseList = (lines: string[], start: number): { block: Block; next: number } => {
  const first = LIST_ITEM.exec(lines[start]) as RegExpExecArray;
  const baseIndent = indentOf(lines[start]);
  const ordered = /\d/.test(first[2]);
  const items: { text: string[]; childLines: string[] }[] = [];
  let index = start;

  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      // 空行のあとに、同じリストの続き（項目または字下げされた行）があれば続ける
      let peek = index + 1;
      while (peek < lines.length && lines[peek].trim() === '') peek += 1;
      if (peek >= lines.length || items.length === 0) break;
      const peekItem = LIST_ITEM.exec(lines[peek]);
      const continues = indentOf(lines[peek]) > baseIndent || (peekItem != null && indentOf(lines[peek]) === baseIndent && /\d/.test(peekItem[2]) === ordered);
      if (!continues) break;
      if (indentOf(lines[peek]) > baseIndent) items[items.length - 1].childLines.push('');
      index = peek;
      continue;
    }
    const indent = indentOf(line);
    const item = LIST_ITEM.exec(line);
    if (item && indent === baseIndent) {
      if (/\d/.test(item[2]) !== ordered) break;
      items.push({ text: [item[3]], childLines: [] });
    } else if (indent > baseIndent && items.length > 0) {
      const current = items[items.length - 1];
      // 入れ子のリスト・ブロックは子として、ただの続きの行は本文に足す
      if (current.childLines.length > 0 || item || startsBlock(lines, index)) current.childLines.push(line);
      else current.text.push(line.trim());
    } else {
      break;
    }
    index += 1;
  }

  const startNumber = ordered ? Number(/\d+/.exec(first[2])?.[0] ?? 1) : 1;
  return {
    block: {
      type: 'list',
      ordered,
      start: startNumber,
      items: items.map((entry) => {
        const minIndent = Math.min(...entry.childLines.filter((line) => line.trim() !== '').map(indentOf), Number.MAX_SAFE_INTEGER);
        const dedented = entry.childLines.map((line) => (line.trim() === '' ? '' : line.replace(/\t/g, '    ').slice(minIndent)));
        return { inline: parseInline(entry.text.join('\n')), children: parseBlocks(dedented) };
      }),
    },
    next: index,
  };
};

const parseBlocks = (lines: string[]): Block[] => {
  const blocks: Block[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(fence[1])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6, inline: parseInline(heading[2]) });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (BLOCKQUOTE.test(line)) {
      const body: string[] = [];
      while (index < lines.length && BLOCKQUOTE.test(lines[index])) {
        body.push((BLOCKQUOTE.exec(lines[index]) as RegExpExecArray)[1]);
        index += 1;
      }
      blocks.push({ type: 'blockquote', blocks: parseBlocks(body) });
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitTableRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim() !== '' && lines[index].includes('|')) {
        const cells = splitTableRow(lines[index]).map(parseInline);
        // 列の数を見出しにそろえる
        while (cells.length < header.length) cells.push([]);
        rows.push(cells.slice(0, header.length));
        index += 1;
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const { block, next } = parseList(lines, index);
      blocks.push(block);
      index = next;
      continue;
    }

    const paragraph: string[] = [line.trim()];
    index += 1;
    while (index < lines.length && lines[index].trim() !== '' && !startsBlock(lines, index)) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join('\n')) });
  }
  return blocks;
};

export const parseMarkdown = (source: string): Block[] => parseBlocks(source.replace(/\r\n?/g, '\n').split('\n'));

// ---- リンクの扱い ----

export type ResolvedLink = { kind: 'external'; href: string } | { kind: 'internal'; href: string } | null;

/**
 * リンク先を確かめる。アンカーにしてよいのは http(s) の URL と、一覧にある別の文書だけ。
 * それ以外（javascript: や data:、相対パス、未知のファイル）は null を返し、描画側はただの文字にする。
 * docPaths: 文書のファイル名 → 画面のパス（例: '04-shareholders-meeting.md' → '/legal-guide/shareholders-meeting'）
 */
export const resolveLink = (href: string, docPaths: ReadonlyMap<string, string>): ResolvedLink => {
  const trimmed = href.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol === 'http:' || url.protocol === 'https:') return { kind: 'external', href: url.toString() };
    } catch {
      return null;
    }
    return null;
  }
  const match = /^(?:\.\/)?([A-Za-z0-9._-]+\.md)(?:#.*)?$/.exec(trimmed);
  if (match) {
    const path = docPaths.get(match[1]);
    if (path) return { kind: 'internal', href: path };
  }
  return null;
};

// お知らせの本文を、表示用のブロックに分ける。サーバ依存なし。
//
// 使える書き方は 3 つだけ: 見出し（行頭の「# 」「## 」「### 」）、箇条書き（行頭の「- 」）、段落（空行で区切る。段落の中の改行は改行として出す）。
// HTML としては解釈しない（ブロックは文字列のまま React の要素にするので、タグを書いても文字として表示される）。

export type UpdateBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'paragraph'; lines: string[] };

const HEADING = /^(#{1,3})[ \u3000]+(.+)$/;
const LIST_ITEM = /^[-・*][ \u3000]+(.+)$/;

export const parseUpdateBody = (body: string | null | undefined): UpdateBlock[] => {
  const blocks: UpdateBlock[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flush = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', lines: paragraph });
    if (list.length > 0) blocks.push({ type: 'list', items: list });
    paragraph = [];
    list = [];
  };

  for (const rawLine of (body ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    if (trimmed === '') {
      flush();
      continue;
    }
    const heading = trimmed.match(HEADING);
    if (heading) {
      flush();
      blocks.push({ type: 'heading', level: heading[1].length as 1 | 2 | 3, text: heading[2].trim() });
      continue;
    }
    const item = trimmed.match(LIST_ITEM);
    if (item) {
      if (paragraph.length > 0) flush();
      list.push(item[1].trim());
      continue;
    }
    if (list.length > 0) flush();
    paragraph.push(trimmed);
  }
  flush();
  return blocks;
};

/** 一覧に出す短い抜粋（見出しを除いた最初の文章） */
export const updateExcerpt = (body: string | null | undefined, maxLength = 120): string => {
  const parts: string[] = [];
  for (const block of parseUpdateBody(body)) {
    if (block.type === 'paragraph') parts.push(block.lines.join(' '));
    if (block.type === 'list') parts.push(block.items.join('、'));
    if (parts.join(' ').length >= maxLength) break;
  }
  const text = parts.join(' ');
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
};

// テンプレートの文面の中の差し込み項目（{{会社名}}）を見つける・確かめる・値に置き換える。サーバ依存なし。
//
// 置き換えは文字の置き換えだけで、AI は使わない（同じテンプレートと同じ台帳からは、いつも同じ文書ができる）。
// 値が無い項目は「【要確認: 項目名】」にして残し、何が埋まらなかったかを返す（空のまま気づかれないようにする）。

import { findPlaceholder, needsReviewMark, type PlaceholderDef, type PlaceholderScope } from './placeholders';

/** {{名前}}（全角の ｛｛名前｝｝ も受け付ける）。名前は 1〜40 文字で、波かっこ・改行を含まない */
const PLACEHOLDER_SOURCE = '(?:\\{\\{|｛｛)[ \\t　]*([^{}｛｝\\r\\n]{1,40}?)[ \\t　]*(?:\\}\\}|｝｝)';

export const placeholderPattern = (): RegExp => new RegExp(PLACEHOLDER_SOURCE, 'g');

/** 文面に出てくる差し込み項目の名前（出てきた順・重複なし） */
export const extractPlaceholders = (body: string): string[] => {
  const names = new Set<string>();
  for (const match of body.matchAll(placeholderPattern())) names.add(match[1]);
  return [...names];
};

export interface TemplateAnalysis {
  /** 文面で使っている差し込み項目（この種類で使えるもの） */
  used: PlaceholderDef[];
  /** 一覧に無い名前（置き換えられない） */
  unknown: string[];
  /** 一覧にはあるが、この種類のテンプレートでは値を入れられない名前（例: 議事録に {{投資額}}） */
  outOfScope: string[];
}

/** 文面の差し込み項目を、種類ごとに使える出どころ（scopes）と照らす */
export const analyzeTemplate = (body: string, scopes: readonly PlaceholderScope[]): TemplateAnalysis => {
  const analysis: TemplateAnalysis = { used: [], unknown: [], outOfScope: [] };
  for (const name of extractPlaceholders(body)) {
    const def = findPlaceholder(name);
    if (!def) analysis.unknown.push(name);
    else if (!scopes.includes(def.scope)) analysis.outOfScope.push(name);
    else analysis.used.push(def);
  }
  return analysis;
};

/** 差し込み項目の値。null・空文字は「台帳に値が無い」 */
export type TemplateValues = Record<string, string | null | undefined>;

export interface FillResult {
  text: string;
  /** 台帳に値が無かった項目（【要確認】にした） */
  missing: string[];
  /** 置き換えられない名前（一覧に無い・この種類では値を入れられない。【要確認】にした） */
  unknown: string[];
}

/** 文面の差し込み項目を値に置き換える。値が無い・分からない項目は【要確認: 名前】にする */
export const fillTemplate = (body: string, values: TemplateValues): FillResult => {
  const missing = new Set<string>();
  const unknown = new Set<string>();
  const text = body.replace(placeholderPattern(), (_whole, name: string) => {
    if (!Object.hasOwn(values, name)) {
      unknown.add(name);
      return needsReviewMark(name);
    }
    const value = values[name];
    if (value == null || value.trim() === '') {
      missing.add(name);
      return needsReviewMark(name);
    }
    return value;
  });
  return { text, missing: [...missing], unknown: [...unknown] };
};

/**
 * 使えない差し込み項目（一覧に無い・この種類では値を入れられない）を【要確認: 名前】に書き換える。
 * AI が書いたひな形を受け取ったときに通す（一覧に無い名前を作ることがあるため）。書き換えた名前を返す。
 */
export const replaceUnusablePlaceholders = (
  body: string,
  scopes: readonly PlaceholderScope[],
): { body: string; replaced: string[] } => {
  const replaced = new Set<string>();
  const next = body.replace(placeholderPattern(), (whole, name: string) => {
    const def = findPlaceholder(name);
    if (def && scopes.includes(def.scope)) return `{{${name}}}`;
    replaced.add(name);
    return needsReviewMark(name);
  });
  return { body: next, replaced: [...replaced] };
};

export type BodySegment =
  | { type: 'text'; text: string }
  | { type: 'placeholder'; name: string; known: boolean }
  | { type: 'review'; text: string };

/** 画面で色を付けて見せるために、文面を「地の文・差し込み項目・【要確認】」に分ける */
export const segmentBody = (body: string, scopes: readonly PlaceholderScope[]): BodySegment[] => {
  const pattern = new RegExp(`${PLACEHOLDER_SOURCE}|(【要確認[^】]*】)`, 'g');
  const segments: BodySegment[] = [];
  let last = 0;
  for (const match of body.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: 'text', text: body.slice(last, index) });
    if (match[2]) {
      segments.push({ type: 'review', text: match[2] });
    } else {
      const def = findPlaceholder(match[1]);
      segments.push({ type: 'placeholder', name: match[1], known: Boolean(def && scopes.includes(def.scope)) });
    }
    last = index + match[0].length;
  }
  if (last < body.length) segments.push({ type: 'text', text: body.slice(last) });
  return segments;
};

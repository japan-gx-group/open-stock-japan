// 手元のひな形（契約書・議事録など）の「空欄」を、差し込み項目に置き換える。サーバ依存なし。
//
// AI は「どの空欄を、どの差し込み項目にするか」の案（find → replace）を返すだけで、文面は書き換えない。
// 置き換えは、ここで機械的に行う。案を使うのは、次をすべて満たすときだけ:
//   - find が、文面の中にちょうど 1 か所ある（空白の違いは無視して探す）。
//     ただし find が角かっこ 1 つだけ（例: [発行会社名称]）のときは、同じ角かっこのすべてを置き換える
//   - replace が、find の空欄を {{差し込み項目}} に置き換えただけのものである（空欄以外の文字が同じ）
//   - 差し込み項目が、その種類のテンプレートで使える名前である
// 出来上がる文面は、もとの文面の空欄を置き換えただけのものになる（空欄以外の文字は、空白も含めて変わらない）。
// 満たさない案は使わず、理由を返す（人が自分で直せるように）。
//
// 空欄として扱うもの:
//   - ●・○・〇・◯・＿・_ の並び
//   - 短い角かっこ（[発行会社名称]・[●]・中身の無いもの）。ひな形で「ここは記入する」と示された箇所
//   - 数字だけの角かっこ（[100,000,000]・[0.8]・[1億円]）。ひな形の初期値。かっこの中の単位は、置き換えたあとも文面に残す
//   - 日付の空欄（●年●月●日・20＿年＿月＿日）

import { placeholderPattern } from './fill';
import { findPlaceholder, placeholderToken, type PlaceholderScope } from './placeholders';

export interface BlankReplacement {
  find: string;
  replace: string;
}

export interface AppliedReplacement {
  /** 文面の中の、もとの文字 */
  before: string;
  /** 置き換えたあとの文字 */
  after: string;
  names: string[];
  /** 置き換えた箇所の数（角かっこ 1 つだけの案は、同じ角かっこのすべてを置き換える） */
  count: number;
}

export interface SkippedReplacement {
  find: string;
  reason: string;
}

export interface ConvertResult {
  body: string;
  applied: AppliedReplacement[];
  skipped: SkippedReplacement[];
  /** 置き換えたあとも残っている空欄の数 */
  remainingBlanks: number;
}

const BLANK = '●○〇◯＿_';
const SPACE = '\\s\\u3000';
const UNIT = '円|％|%|か月|ヶ月|ケ月|箇月|倍|日|年|名|個|株';
const AFFIX = '株式会社|合同会社|有限会社';
const OPEN = '[\\[［]';
const CLOSE = '[\\]］]';

// 日付の空欄（●年●月●日、20＿年＿月＿日。空白を空けただけの「令和 年 月 日」も含む）
const DATE_BLANK = `(?:令和|平成|西暦|20|２０)?[${BLANK}${SPACE}]*年[${BLANK}${SPACE}]*月[${BLANK}${SPACE}]*日`;
// 数字だけの角かっこ（ひな形の初期値）。単位は、置き換えたあとに文面へ残す
const NUMERIC_BRACKET = `${OPEN}[${SPACE}]*[0-9０-９][0-9０-９,，.．]*[万億兆千百十]*[${SPACE}]*(${UNIT})?[${SPACE}]*${CLOSE}`;
// 短い角かっこ（記入する箇所の名前・●・空）。文（「。」を含むもの）や長い注記は、空欄として扱わない
const SHORT_BRACKET = `${OPEN}[^\\[\\]［］。\\n]{0,40}${CLOSE}`;
const BLANK_RUN = `[${BLANK}]+`;
// 「●●株式会社」「株式会社●●」は、会社の名前ごと 1 つの空欄として扱える（{{会社名}} には「株式会社」も入っているため）
const AFFIX_BLANK = `(?:${AFFIX})[${SPACE}]*[${BLANK}]+|[${BLANK}]+[${SPACE}]*(?:${AFFIX})`;

const MAX_FIND_LENGTH = 200;
const MAX_REPLACEMENTS = 300;

type Piece =
  | { type: 'text'; value: string }
  | { type: 'blank'; date: boolean; raw: string; unit: string }
  | { type: 'placeholder'; name: string; date: boolean };

type Slot = Exclude<Piece, { type: 'text' }>;

const stripSpaces = (value: string): string => value.replace(new RegExp(`[${SPACE}]+`, 'g'), '');

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 日付の空欄の候補のうち、空欄の記号か空白を含むものだけを日付の空欄とみなす（「年月日」という語そのものは除く） */
const looksLikeDateBlank = (value: string): boolean => new RegExp(`[${BLANK}${SPACE}]`).test(value);

/** 文字の並びを「地の文・空欄・差し込み項目」に分ける */
const splitPieces = (value: string, absorbAffix: boolean): Piece[] => {
  const placeholder = placeholderPattern().source;
  const pattern = new RegExp(
    `(${placeholder})|(${DATE_BLANK})|(${NUMERIC_BRACKET})|(${SHORT_BRACKET})|${absorbAffix ? `(${AFFIX_BLANK})|` : '()'}(${BLANK_RUN})`,
    'g',
  );
  // グループの番号: 1 = 差し込み項目（2 = 名前）、3 = 日付、4 = 数字の角かっこ（5 = 単位）、6 = 短い角かっこ、7 = 会社の名前、8 = 空欄の並び
  const pieces: Piece[] = [];
  let last = 0;
  const pushText = (text: string) => {
    if (text !== '') pieces.push({ type: 'text', value: text });
  };
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0;
    const whole = match[0];
    if (whole === '') continue;
    if (match[3] !== undefined && !looksLikeDateBlank(whole)) continue;
    pushText(value.slice(last, index));
    if (match[1] !== undefined) {
      const def = findPlaceholder(match[2]);
      pieces.push({ type: 'placeholder', name: match[2], date: def?.format === 'date' });
    } else if (match[3] !== undefined) {
      pieces.push({ type: 'blank', date: true, raw: whole, unit: '' });
    } else if (match[4] !== undefined) {
      pieces.push({ type: 'blank', date: false, raw: whole, unit: match[5] ?? '' });
    } else {
      pieces.push({ type: 'blank', date: false, raw: whole, unit: '' });
    }
    last = index + whole.length;
  }
  pushText(value.slice(last));
  return pieces;
};

type Comparable = { type: 'text'; value: string } | { type: 'slot'; piece: Slot };

/** 比べるための形: 空白を除いた地の文をつなげ、数字の角かっこの単位は地の文として数える */
const toComparable = (pieces: Piece[]): Comparable[] => {
  const result: Comparable[] = [];
  const pushText = (value: string) => {
    const text = stripSpaces(value);
    if (text === '') return;
    const previous = result[result.length - 1];
    if (previous?.type === 'text') previous.value += text;
    else result.push({ type: 'text', value: text });
  };
  for (const piece of pieces) {
    if (piece.type === 'text') {
      pushText(piece.value);
    } else {
      result.push({ type: 'slot', piece });
      if (piece.type === 'blank') pushText(piece.unit);
    }
  }
  return result;
};

/** replace が「find の空欄を差し込み項目にしただけ」かを確かめる */
const sameExceptBlanks = (find: Comparable[], replace: Comparable[]): boolean => {
  if (find.length !== replace.length) return false;
  return find.every((left, index) => {
    const right = replace[index];
    if (left.type === 'text') return right.type === 'text' && left.value === right.value;
    if (right.type === 'text') return false;
    // find の側に差し込み項目がある（すでに置き換え済み）なら、replace も同じ名前のまま
    if (left.piece.type === 'placeholder') return right.piece.type === 'placeholder' && right.piece.name === left.piece.name;
    if (right.piece.type === 'blank') return right.piece.date === left.piece.date;
    // 日付の空欄には、日付の差し込み項目だけを入れられる
    return right.piece.type === 'placeholder' && (!left.piece.date || right.piece.date);
  });
};

/** find の文字を、空白の違いと、空欄の記号の個数の違い（●● と ●●●）を無視して文面から探すための正規表現 */
const tolerantPattern = (find: string): RegExp => {
  const parts: string[] = [];
  let inBlankRun = false;
  for (const char of stripSpaces(find)) {
    if (BLANK.includes(char)) {
      if (!inBlankRun) parts.push(BLANK_RUN);
      inBlankRun = true;
    } else {
      parts.push(escapeRegExp(char));
      inBlankRun = false;
    }
  }
  return new RegExp(parts.join(`[${SPACE}]*`), 'g');
};

const slotsOf = (pieces: Piece[]): Slot[] => pieces.filter((piece): piece is Slot => piece.type !== 'text');

type Attempt = { ok: true; after: string; names: string[] } | { ok: false };

/** もとの文字（actual）の空欄を、replace の差し込み項目に置き換える。空欄以外の文字は actual のまま */
const rebuild = (actual: string, replace: string, absorbAffix: boolean): Attempt => {
  const findPieces = splitPieces(actual, absorbAffix);
  const replacePieces = splitPieces(replace, false);
  if (!sameExceptBlanks(toComparable(findPieces), toComparable(replacePieces))) return { ok: false };

  const targets = slotsOf(replacePieces);
  const names: string[] = [];
  let slot = 0;
  const after = findPieces
    .map((piece) => {
      if (piece.type === 'text') return piece.value;
      const target = targets[slot];
      slot += 1;
      if (piece.type === 'placeholder') return placeholderToken(piece.name);
      if (target?.type !== 'placeholder') return piece.raw;
      names.push(target.name);
      return `${placeholderToken(target.name)}${piece.unit}`;
    })
    .join('');
  return names.length > 0 ? { ok: true, after, names } : { ok: false };
};

/** 記入する箇所の名前が入った角かっこ 1 つだけか（例: [発行会社名称]）。同じ名前の角かっこは、どこでも同じものを指す */
const isLabelBracket = (find: string): boolean => {
  const text = find.trim();
  if (!new RegExp(`^${SHORT_BRACKET}$`).test(text) || new RegExp(`^${NUMERIC_BRACKET}$`).test(text)) return false;
  // 中身が、空・空欄の記号だけのもの（[●]）は、場所ごとに入るものが違うので含めない
  return stripSpaces(text.slice(1, -1)).replace(new RegExp(`[${BLANK}]`, 'g'), '') !== '';
};

/** 文面に残っている空欄の数（数字の角かっこは、初期値のまま使うことがあるので数えない） */
export const countBlanks = (body: string): number => {
  const pattern = new RegExp(`(${DATE_BLANK})|(${NUMERIC_BRACKET})|${SHORT_BRACKET}|${BLANK_RUN}`, 'g');
  // グループの番号: 1 = 日付の形、2 = 数字の角かっこ（3 = 単位）
  // 日付の形（年月日）は、空欄の記号（● など）を含むものだけを数える（語としての「年月日」を空欄に数えない）
  return [...body.matchAll(pattern)].filter((match) => {
    if (match[2] !== undefined) return false;
    return match[1] === undefined || new RegExp(`[${BLANK}]`).test(match[0]);
  }).length;
};

/** AI の案を確かめながら、文面の空欄を差し込み項目に置き換える */
export const applyBlankReplacements = (
  source: string,
  replacements: readonly BlankReplacement[],
  scopes: readonly PlaceholderScope[],
): ConvertResult => {
  let body = source;
  const applied: AppliedReplacement[] = [];
  const skipped: SkippedReplacement[] = [];

  for (const { find, replace } of replacements.slice(0, MAX_REPLACEMENTS)) {
    const skip = (reason: string) => skipped.push({ find: find.slice(0, MAX_FIND_LENGTH), reason });
    if (stripSpaces(find).length < 2 || find.length > MAX_FIND_LENGTH) {
      skip('探す文字が短すぎるか、長すぎます');
      continue;
    }

    const unusable = [...replace.matchAll(placeholderPattern())]
      .map((match) => match[1])
      .find((name) => {
        const def = findPlaceholder(name);
        return !def || !scopes.includes(def.scope);
      });
    if (unusable !== undefined) {
      skip(`この種類のテンプレートでは使えない差し込み項目です: ${unusable}`);
      continue;
    }

    const matches = [...body.matchAll(tolerantPattern(find))];
    if (matches.length === 0) {
      skip('文面の中に見つかりません（すでに置き換えた箇所か、文面と違う文字です）');
      continue;
    }
    if (matches.length > 1 && !isLabelBracket(find)) {
      skip('同じ文字が文面に複数あり、どこを置き換えるか決められません');
      continue;
    }

    const actual = matches[0][0];
    const plain = rebuild(actual, replace, false);
    const attempt = plain.ok ? plain : rebuild(actual, replace, true);
    if (!attempt.ok) {
      skip('空欄以外の文字が変わるため、置き換えませんでした');
      continue;
    }

    // 後ろから置き換える（前の位置がずれないように）
    for (const match of [...matches].reverse()) {
      const start = match.index ?? 0;
      body = `${body.slice(0, start)}${attempt.after}${body.slice(start + match[0].length)}`;
    }
    applied.push({ before: actual, after: attempt.after, names: attempt.names, count: matches.length });
  }

  return { body, applied, skipped, remainingBlanks: countBlanks(body) };
};

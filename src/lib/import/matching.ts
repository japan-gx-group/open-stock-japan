// 読み取った名前と、台帳の行の照合（純関数）。
//
// 表記のゆれ（空白・全角と半角・株式会社と（株）と ㈱ など）を揃えて比べる。
//   exact      … 揃えた名前が 1 件だけ一致（既定でその行を使う）
//   candidates … 似た名前がある（法人の種類を除くと同じ・片方がもう片方を含む・同じ名前が複数）。人が選ぶ
//   none       … 見つからない（新しく作る）
// 照合の結果は既定値に使うだけで、確認画面でいつでも選び直せる。

import type { NamedRow, NameMatch } from './types';

/** 法人の種類の略記（NFKC のあと。㈱ は NFKC で (株) になる） */
const CORPORATE_ABBREVIATIONS: readonly [RegExp, string][] = [
  [/\(株\)/g, '株式会社'],
  [/\(有\)/g, '有限会社'],
  [/\(同\)/g, '合同会社'],
  [/\(資\)/g, '合資会社'],
  [/\(名\)/g, '合名会社'],
  [/\(一社\)/g, '一般社団法人'],
  [/\(一財\)/g, '一般財団法人'],
];

const CORPORATE_FORMS = /株式会社|有限会社|合同会社|合資会社|合名会社|一般社団法人|一般財団法人|投資事業有限責任組合|有限責任事業組合/g;

/** 名前を比べるための形にする（全角・半角、空白、中黒、大文字・小文字、法人の種類の略記を揃える） */
export const normalizeEntityName = (name: string): string => {
  let text = name.normalize('NFKC').toLowerCase();
  text = text.replace(/[\s・･,，、]/g, '');
  for (const [pattern, replacement] of CORPORATE_ABBREVIATIONS) text = text.replace(pattern, replacement);
  // 敬称（文書の宛名から写された場合）
  return text.replace(/(様|殿|御中)$/, '');
};

/** 法人の種類を除いた名前（「株式会社みらい」と「みらい株式会社」「みらい」を候補として拾うため） */
export const stripCorporateForm = (normalized: string): string => normalized.replace(CORPORATE_FORMS, '');

const KANJI_DIGITS: Record<string, number> = { 〇: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 「第三回」「第十二回」の漢数字を算用数字にする（99 まで） */
const kanjiOrdinalToDigits = (text: string): string =>
  text.replace(/第([〇一二三四五六七八九十]{1,3})(回|期|号)/g, (whole, digits: string, suffix: string) => {
    let value = 0;
    if (digits.includes('十')) {
      const [tens, ones] = digits.split('十');
      value = (tens ? KANJI_DIGITS[tens] : 1) * 10 + (ones ? KANJI_DIGITS[ones] : 0);
    } else {
      value = Number([...digits].map((digit) => KANJI_DIGITS[digit]).join(''));
    }
    return Number.isFinite(value) ? `第${value}${suffix}` : whole;
  });

/** 株式の種類の名前を比べる形にする（「A種優先株式」「Ａ種優先株」「a 種 優先 株式」を同じに扱う） */
export const normalizeShareClassName = (name: string): string =>
  name
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s・･]/g, '')
    .replace(/(株式|株)$/, '');

/** 回次・ラウンド・会議の名前を比べる形にする */
export const normalizeTitle = (name: string): string =>
  kanjiOrdinalToDigits(name.normalize('NFKC').toLowerCase().replace(/[\s・･\-‐–—]/g, ''));

const MAX_CANDIDATES = 5;
/** 片方がもう片方を含む、を候補にする最小の長さ（短い名前の偶然の一致を避ける） */
const MIN_CONTAIN_LENGTH = 3;

const matchWith = (
  name: string | null | undefined,
  rows: readonly NamedRow[],
  normalize: (value: string) => string,
  loosen: ((normalized: string) => string) | null,
): NameMatch => {
  const key = name ? normalize(name) : '';
  if (key === '') return { status: 'none', id: null, candidates: [] };

  const keyed = rows.map((row) => ({ row, key: normalize(row.label) }));
  const exact = keyed.filter((entry) => entry.key === key).map((entry) => entry.row);
  if (exact.length === 1) return { status: 'exact', id: exact[0].id, candidates: exact };
  // 同じ名前が複数あるときは、どれかを人が選ぶ
  if (exact.length > 1) return { status: 'candidates', id: null, candidates: exact.slice(0, MAX_CANDIDATES) };

  const loose = loosen ? loosen(key) : key;
  const similar = keyed
    .filter((entry) => {
      const other = loosen ? loosen(entry.key) : entry.key;
      if (loose === '' || other === '') return false;
      if (loose === other) return true;
      const [shorter, longer] = loose.length <= other.length ? [loose, other] : [other, loose];
      return shorter.length >= MIN_CONTAIN_LENGTH && longer.includes(shorter);
    })
    .map((entry) => entry.row);
  return similar.length > 0
    ? { status: 'candidates', id: null, candidates: similar.slice(0, MAX_CANDIDATES) }
    : { status: 'none', id: null, candidates: [] };
};

/** 株主・権利者の照合 */
export const matchStakeholder = (name: string | null | undefined, rows: readonly NamedRow[]): NameMatch =>
  matchWith(name, rows, normalizeEntityName, stripCorporateForm);

/** 株式の種類の照合 */
export const matchShareClass = (name: string | null | undefined, rows: readonly NamedRow[]): NameMatch =>
  matchWith(name, rows, normalizeShareClassName, null);

/** 回次・ラウンド・会議などの名前の照合 */
export const matchTitle = (name: string | null | undefined, rows: readonly NamedRow[]): NameMatch =>
  matchWith(name, rows, normalizeTitle, null);

export interface FiscalYearRow extends NamedRow {
  startDate: string;
  endDate: string;
}

/** 決算の期間から事業年度を選ぶ。期間が一致すれば exact、期末がその年度に入っていれば candidates */
export const matchFiscalYear = (periodStart: string | null, periodEnd: string | null, years: readonly FiscalYearRow[]): NameMatch => {
  if (!periodEnd) return { status: 'none', id: null, candidates: [] };
  const same = years.filter((year) => year.endDate === periodEnd && (!periodStart || year.startDate === periodStart));
  if (same.length === 1) return { status: 'exact', id: same[0].id, candidates: [{ id: same[0].id, label: same[0].label }] };
  const containing = years.filter((year) => year.startDate <= periodEnd && periodEnd <= year.endDate);
  return containing.length > 0
    ? { status: 'candidates', id: null, candidates: containing.slice(0, MAX_CANDIDATES).map((year) => ({ id: year.id, label: year.label })) }
    : { status: 'none', id: null, candidates: [] };
};

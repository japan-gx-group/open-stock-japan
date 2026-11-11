// 日本語の数値入力の解釈と、金額・株式数・日付の表示。サーバ依存なし。

const toHalfWidth = (value: string): string =>
  value.replace(/[０-９．，－]/g, (ch) => (ch === '－' ? '-' : String.fromCharCode(ch.charCodeAt(0) - 0xfee0)));

/**
 * 「50,000,000」「5000万」「1.1億」「３億5,000万円」のような入力を数値にする。
 * 全角数字・カンマ・単位（円・株・個・%）を許容する。解釈できなければ null。
 */
export const parseNumberText = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  let raw = toHalfWidth(value.trim()).replace(/[,\s円株個%％]/g, '');
  if (!raw) return null;
  let sign = 1;
  if (raw.startsWith('-')) {
    sign = -1;
    raw = raw.slice(1);
  }
  if (/^\d+(?:\.\d+)?$/.test(raw)) return sign * Number(raw);

  // 億・万の組み合わせ（1億5000万 / 1.1億 / 5000万）
  const match = raw.match(/^(?:(\d+(?:\.\d+)?)億)?(?:(\d+(?:\.\d+)?)万)?(\d+(?:\.\d+)?)?$/);
  if (!match || (match[1] == null && match[2] == null)) return null;
  const oku = match[1] ? Number(match[1]) * 100_000_000 : 0;
  const man = match[2] ? Number(match[2]) * 10_000 : 0;
  const rest = match[3] ? Number(match[3]) : 0;
  // 1.1億 のような小数を掛けたときの浮動小数の誤差（110000000.00000001）を落とす
  return sign * Number((oku + man + rest).toFixed(4));
};

/** 円未満切り上げ。浮動小数の誤差で繰り上がらないよう丸めてから切り上げる。 */
export const ceilYen = (value: number): number => Math.ceil(Number(value.toFixed(6)));

/** 50,000,000 → 「5,000万円」、110,000,000 → 「1億1,000万円」、1,234 → 「1,234円」 */
export const formatYenJa = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(Math.round(value));
  if (abs >= 10_000 && abs % 10_000 === 0) {
    const oku = Math.floor(abs / 100_000_000);
    const man = (abs % 100_000_000) / 10_000;
    const parts: string[] = [];
    if (oku > 0) parts.push(`${oku.toLocaleString('ja-JP')}億`);
    if (man > 0) parts.push(`${man.toLocaleString('ja-JP')}万`);
    return `${sign}${parts.join('')}円`;
  }
  return `${sign}${abs.toLocaleString('ja-JP')}円`;
};

export const formatYen = (value: number | null | undefined, fractionDigits = 0): string => {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toLocaleString('ja-JP', { minimumFractionDigits: 0, maximumFractionDigits: fractionDigits })}円`;
};

export const formatNumber = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('ja-JP');

export const formatShares = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '—' : `${value.toLocaleString('ja-JP')}株`;

export const formatUnits = (value: number | null | undefined): string =>
  value == null || !Number.isFinite(value) ? '—' : `${value.toLocaleString('ja-JP')}個`;

export const formatRatio = (ratio: number | null | undefined, digits = 2): string =>
  ratio == null || !Number.isFinite(ratio) ? '—' : `${(ratio * 100).toFixed(digits)}%`;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const isValidDateText = (value: string): boolean => {
  if (!DATE_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** 2026-11-11 → 「2026年11月11日」 */
export const formatDateJa = (value: string | null | undefined): string => {
  if (!value || !isValidDateText(value.slice(0, 10))) return '—';
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return `${year}年${month}月${day}日`;
};

/** 和暦（令和8年11月11日）。議事録・招集通知の文面に使う。 */
export const formatDateWareki = (value: string | null | undefined): string => {
  if (!value || !isValidDateText(value.slice(0, 10))) return '—';
  return new Intl.DateTimeFormat('ja-JP-u-ca-japanese', {
    era: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
};

/** 今日の日付（Asia/Tokyo）を YYYY-MM-DD で返す */
export const todayInTokyo = (now: Date = new Date()): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

// ---- 日付の計算（YYYY-MM-DD の文字列どうし。タイムゾーンの影響を受けない） ----

const toUtc = (date: string): Date => new Date(`${date}T00:00:00Z`);
const fromUtc = (date: Date): string => date.toISOString().slice(0, 10);

export const addDays = (date: string, days: number): string => {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return fromUtc(d);
};

/** 月を足す。応当日が無い月は月末に寄せる（1/31 + 1 か月 = 2/28）。民法143条の暦による計算に合わせる。 */
export const addMonths = (date: string, months: number): string => {
  const d = toUtc(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return fromUtc(d);
};

export const addYears = (date: string, years: number): string => addMonths(date, years * 12);

/** to − from の日数（同じ日は 0） */
export const diffDays = (from: string, to: string): number =>
  Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);

/** from から to までに経過した満月数（応当日の前日までは数えない） */
export const fullMonthsBetween = (from: string, to: string): number => {
  if (to < from) return 0;
  const a = toUtc(from);
  const b = toUtc(to);
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (addMonths(from, months) > to) months -= 1;
  return Math.max(0, months);
};

export const endOfMonth = (date: string): string => {
  const d = toUtc(date);
  return fromUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
};

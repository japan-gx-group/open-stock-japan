// 監査ログの日時の表示と出力。サーバ依存なし。
//
// 記録時刻はマイクロ秒まで DB が持っていて、ハッシュの計算にもマイクロ秒までの値が入る。
// JavaScript の Date はミリ秒までなので、秒より下の桁は文字のまま運ぶ（Date に通して桁を落とさない）。
// 画面と CSV の「日本時間」は、見る人の端末の設定に関係なく Asia/Tokyo（UTC+9。夏時間なし）で出す。

const TIMESTAMP_PATTERN = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

interface ParsedTimestamp {
  /** 秒までの時刻（UTC のミリ秒） */
  epochMs: number;
  /** 秒より下の 6 桁（マイクロ秒） */
  micros: string;
}

const normalizeOffset = (offset: string | undefined): string => {
  if (!offset || offset === 'Z') return 'Z';
  // +09 / +0900 / +09:00 を +09:00 にそろえる
  const digits = offset.slice(1).replace(':', '').padEnd(4, '0');
  return `${offset[0]}${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
};

/** DB（PostgREST）が返す timestamptz の文字を読む。読めなければ null */
export const parseTimestamp = (value: string | null | undefined): ParsedTimestamp | null => {
  if (!value) return null;
  const match = TIMESTAMP_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, date, time, fraction, offset] = match;
  const epochMs = Date.parse(`${date}T${time}${normalizeOffset(offset)}`);
  if (Number.isNaN(epochMs)) return null;
  return { epochMs, micros: (fraction ?? '').slice(0, 6).padEnd(6, '0') };
};

const pad = (value: number): string => String(value).padStart(2, '0');

const partsOf = (epochMs: number): { date: string; time: string } => {
  const date = new Date(epochMs);
  return {
    date: `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`,
    time: `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`,
  };
};

/**
 * ISO 8601 の UTC（マイクロ秒まで。例: 2026-11-11T04:03:35.595517Z）。
 * DB がハッシュの計算に使う形（audit_log_canonical）と同じなので、CSV からハッシュを計算し直せる。
 * 読めない値はそのまま返す。
 */
export const toUtcIso = (value: string | null | undefined): string => {
  const parsed = parseTimestamp(value);
  if (!parsed) return value ?? '';
  const { date, time } = partsOf(parsed.epochMs);
  return `${date}T${time}.${parsed.micros}Z`;
};

/** 日本時間の日時（例: 2026/11/11 13:03:35）。値が無ければ空、読めない値はそのまま返す */
export const formatJstDateTime = (value: string | null | undefined): string => {
  const parsed = parseTimestamp(value);
  if (!parsed) return value ?? '';
  const { date, time } = partsOf(parsed.epochMs + JST_OFFSET_MS);
  return `${date.replace(/-/g, '/')} ${time}`;
};

/** 日本時間の日付（例: 2026/11/11）。値が無ければ空 */
export const formatJstDate = (value: string | null | undefined): string => formatJstDateTime(value).slice(0, 10);

/** 日本時間の日付（YYYY-MM-DD）。日付どうしの比較・計算に使う。読めなければ null */
export const jstDateOf = (value: string | null | undefined): string | null => {
  const parsed = parseTimestamp(value);
  return parsed ? partsOf(parsed.epochMs + JST_OFFSET_MS).date : null;
};

/** ファイル名に付ける日本時間の日時（例: 20261111-130335） */
export const fileTimestamp = (now: Date = new Date()): string => {
  const { date, time } = partsOf(now.getTime() + JST_OFFSET_MS);
  return `${date.replace(/-/g, '')}-${time.replace(/:/g, '')}`;
};

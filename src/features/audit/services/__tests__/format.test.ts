import { describe, expect, it } from 'vitest';
import { fileTimestamp, formatJstDate, formatJstDateTime, jstDateOf, parseTimestamp, toUtcIso } from '../format';

describe('toUtcIso', () => {
  it('DB が返す時刻を、UTC の ISO 8601（マイクロ秒まで）にする。秒より下の桁は落とさない', () => {
    expect(toUtcIso('2026-11-11T04:03:35.595517+00:00')).toBe('2026-11-11T04:03:35.595517Z');
    // Postgres は末尾の 0 を省く（.5902 → .590200）
    expect(toUtcIso('2026-11-11T04:03:35.5902+00:00')).toBe('2026-11-11T04:03:35.590200Z');
    expect(toUtcIso('2026-11-11T04:03:35+00:00')).toBe('2026-11-11T04:03:35.000000Z');
    expect(toUtcIso('2026-11-11T04:03:35.777Z')).toBe('2026-11-11T04:03:35.777000Z');
  });

  it('UTC 以外の時差で返ってきても UTC に直す', () => {
    expect(toUtcIso('2026-11-11T13:03:35.595517+09:00')).toBe('2026-11-11T04:03:35.595517Z');
    expect(toUtcIso('2026-11-11 13:03:35.5+09')).toBe('2026-11-11T04:03:35.500000Z');
    expect(toUtcIso('2026-11-10T23:30:00-0530')).toBe('2026-11-11T05:00:00.000000Z');
  });

  it('読めない値はそのまま、無い値は空', () => {
    expect(toUtcIso('いつか')).toBe('いつか');
    expect(toUtcIso(null)).toBe('');
    expect(parseTimestamp('2026-13-45T00:00:00Z')).toBeNull();
  });
});

describe('formatJstDateTime', () => {
  it('日本時間（UTC+9）にする。見る人の端末の設定によらない', () => {
    expect(formatJstDateTime('2026-11-11T04:03:35.595517+00:00')).toBe('2026/11/11 13:03:35');
    expect(formatJstDateTime('2026-11-11T13:03:35+09:00')).toBe('2026/11/11 13:03:35');
  });

  it('日付をまたぐ（UTC の 15:00 が日本時間の翌日 0:00）', () => {
    expect(formatJstDateTime('2026-12-31T15:00:00+00:00')).toBe('2027/01/01 00:00:00');
    expect(formatJstDateTime('2026-12-31T14:59:59.999999+00:00')).toBe('2026/12/31 23:59:59');
    expect(formatJstDate('2026-12-31T15:00:00+00:00')).toBe('2027/01/01');
    expect(jstDateOf('2026-12-31T15:00:00+00:00')).toBe('2027-01-01');
  });

  it('無い値は空', () => {
    expect(formatJstDateTime(null)).toBe('');
    expect(formatJstDate(undefined)).toBe('');
    expect(jstDateOf(null)).toBeNull();
  });
});

describe('fileTimestamp', () => {
  it('ファイル名に付ける日本時間の日時', () => {
    expect(fileTimestamp(new Date('2026-11-11T04:03:05Z'))).toBe('20261111-130305');
    expect(fileTimestamp(new Date('2026-12-31T15:00:00Z'))).toBe('20270101-000000');
  });
});

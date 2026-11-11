import { describe, expect, it } from 'vitest';
import { ACTIVITY_KINDS, isActivityKind, sanitizeActivityDetail } from '../activity';

// ブラウザから届く「出力・印刷の記録」の内容を、決まった形だけに絞るところを確かめる
// （監査ログは追記専用で、あとから直せない。でたらめな値や長い文字列を入れさせない）。

describe('isActivityKind', () => {
  it('決まった種類だけを受け付ける', () => {
    for (const kind of Object.keys(ACTIVITY_KINDS)) expect(isActivityKind(kind)).toBe(true);
    for (const value of ['export.everything', 'auth.login', '', null, 1, 'toString', '__proto__']) {
      expect(isActivityKind(value)).toBe(false);
    }
  });
});

describe('sanitizeActivityDetail', () => {
  it('基準日・行数・ファイル名・対象の id を、形が正しいものだけ残す', () => {
    expect(
      sanitizeActivityDetail({
        asOf: '2026-11-11',
        rows: 5,
        fileName: ' 株主名簿（2026-11-11 現在）.xlsx ',
        entityId: 'ee000000-0000-0000-0000-000000000001',
      }),
    ).toEqual({
      asOf: '2026-11-11',
      rows: 5,
      fileName: '株主名簿（2026-11-11 現在）.xlsx',
      entityId: 'ee000000-0000-0000-0000-000000000001',
    });
    expect(sanitizeActivityDetail({ asOf: null })).toEqual({ asOf: null });
  });

  it('形の違う値と、決まっていない項目は捨てる', () => {
    expect(
      sanitizeActivityDetail({ asOf: '11/11', rows: -1, fileName: '', entityId: 'x', note: '自由な文', actorEmail: 'someone@example.com' }),
    ).toEqual({});
    expect(sanitizeActivityDetail({ rows: 1.5 })).toEqual({});
    expect(sanitizeActivityDetail(null)).toEqual({});
    expect(sanitizeActivityDetail('text')).toEqual({});
  });

  it('ファイル名は 200 文字で切る', () => {
    expect(sanitizeActivityDetail({ fileName: 'あ'.repeat(500) }).fileName).toHaveLength(200);
  });
});

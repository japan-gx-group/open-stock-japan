import { describe, expect, it } from 'vitest';
import {
  containsPattern,
  DEFAULT_PAGE_SIZE,
  formatCursor,
  hasAnyFilter,
  jstRangeOf,
  MAX_KEYWORD_LENGTH,
  MAX_PAGE_SIZE,
  parseAuditLogFilters,
  parseCursor,
  parsePageSize,
  quoteFilterValue,
  toQueryString,
} from '../filters';

const query = (text: string) => new URLSearchParams(text);
const USER_ID = 'AAAAAAAA-0000-0000-0000-000000000001';

describe('parseAuditLogFilters', () => {
  it('条件が無ければ空', () => {
    expect(parseAuditLogFilters(query(''))).toEqual({ ok: true, value: {} });
  });

  it('正しい条件をそのまま取り出す（前後の空白は落とし、uuid は小文字にそろえる）', () => {
    const parsed = parseAuditLogFilters(
      query(
        `from=2026-04-01&to=2026-04-30&source=db&outcome=denied&userId=${USER_ID}&category=equity&entityName=share_transactions&entityId=${USER_ID}&requestId=req-1&q=%20%E5%96%B6%E6%A5%AD%20`,
      ),
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        from: '2026-04-01',
        to: '2026-04-30',
        source: 'db',
        outcome: 'denied',
        userId: USER_ID.toLowerCase(),
        category: 'equity',
        entityName: 'share_transactions',
        entityId: USER_ID.toLowerCase(),
        requestId: 'req-1',
        q: '営業',
      },
    });
  });

  it("userId の 'system' は、操作した人が決まらない記録の指定", () => {
    expect(parseAuditLogFilters(query('userId=system'))).toEqual({ ok: true, value: { userId: 'system' } });
  });

  it('知らない問い合わせの項目は無視する', () => {
    expect(parseAuditLogFilters(query('organizationId=other-org&foo=bar'))).toEqual({ ok: true, value: {} });
  });

  it.each([
    ['from=2026-02-30', '期間の始まり'],
    ['from=20260401', '期間の始まり'],
    ['to=tomorrow', '期間の終わり'],
    ['from=2026-05-01&to=2026-04-30', '終わりより前'],
    ['source=browser', '記録元'],
    ['outcome=ok', '結果'],
    ['userId=1', '操作した人'],
    ["userId=' or 1=1", '操作した人'],
    ['category=everything', '種類'],
    ['entityName=share transactions', '対象の種類'],
    ['entityName=a,b', '対象の種類'],
    ['entityId=123', '対象の指定'],
    ['requestId=a b', 'リクエストの番号'],
    [`requestId=${'x'.repeat(101)}`, 'リクエストの番号'],
    [`q=${'x'.repeat(MAX_KEYWORD_LENGTH + 1)}`, 'キーワード'],
    ['q=a%00b', 'キーワード'],
  ])('正しくない値はエラーにする: %s', (text, message) => {
    const parsed = parseAuditLogFilters(query(text));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });

  it('同じ日だけの期間（始まり = 終わり）は受け付ける', () => {
    expect(parseAuditLogFilters(query('from=2026-04-01&to=2026-04-01')).ok).toBe(true);
  });

  it('キーワードの記号（, ( ) " % _ など）は、そのまま受け付ける（打ち消しは問い合わせを作るときに行う）', () => {
    const parsed = parseAuditLogFilters(query(`q=${encodeURIComponent('a,b("c")%_')}`));
    expect(parsed).toEqual({ ok: true, value: { q: 'a,b("c")%_' } });
  });
});

describe('parsePageSize', () => {
  it('省略すると既定の件数', () => {
    expect(parsePageSize(query(''))).toEqual({ ok: true, value: DEFAULT_PAGE_SIZE });
  });

  it('1〜上限の整数だけを受け付ける', () => {
    expect(parsePageSize(query('limit=1'))).toEqual({ ok: true, value: 1 });
    expect(parsePageSize(query(`limit=${MAX_PAGE_SIZE}`))).toEqual({ ok: true, value: MAX_PAGE_SIZE });
    for (const text of ['limit=0', `limit=${MAX_PAGE_SIZE + 1}`, 'limit=-1', 'limit=1.5', 'limit=abc', 'limit=1e2', 'limit=99999']) {
      expect(parsePageSize(query(text)).ok).toBe(false);
    }
  });
});

describe('parseCursor / formatCursor', () => {
  it('省略すると先頭から', () => {
    expect(parseCursor(query(''))).toEqual({ ok: true, value: null });
  });

  it('連番の続きと、連番なしの記録の続きを読める。作った文字は読み戻せる', () => {
    expect(parseCursor(query('cursor=120'))).toEqual({ ok: true, value: { kind: 'seq', before: 120 } });
    expect(parseCursor(query('cursor=legacy-0'))).toEqual({ ok: true, value: { kind: 'legacy', offset: 0 } });
    expect(parseCursor(query('cursor=legacy-200'))).toEqual({ ok: true, value: { kind: 'legacy', offset: 200 } });
    expect(formatCursor({ kind: 'seq', before: 120 })).toBe('120');
    expect(formatCursor({ kind: 'legacy', offset: 200 })).toBe('legacy-200');
  });

  it('形の違う値はエラーにする', () => {
    for (const text of ['cursor=0', 'cursor=-5', 'cursor=1.5', 'cursor=abc', 'cursor=legacy-', 'cursor=legacy--1', 'cursor=legacy-01', 'cursor=9999999999999999']) {
      expect(parseCursor(query(text)).ok).toBe(false);
    }
  });
});

describe('jstRangeOf', () => {
  it('日本時間の日付を、その日の 0:00 から、終わりの日の翌日 0:00 より前までにする（終わりの日を含む）', () => {
    const range = jstRangeOf({ from: '2026-04-01', to: '2026-04-30' });
    expect(range).toEqual({ since: '2026-04-01T00:00:00+09:00', before: '2026-05-01T00:00:00+09:00' });
    // UTC では前日の 15:00 から
    expect(new Date(range.since ?? '').toISOString()).toBe('2026-03-31T15:00:00.000Z');
    expect(new Date(range.before ?? '').toISOString()).toBe('2026-04-30T15:00:00.000Z');
  });

  it('月末・年末をまたぐ', () => {
    expect(jstRangeOf({ to: '2026-12-31' }).before).toBe('2027-01-01T00:00:00+09:00');
    expect(jstRangeOf({ to: '2028-02-28' }).before).toBe('2028-02-29T00:00:00+09:00');
  });

  it('指定の無い側は null', () => {
    expect(jstRangeOf({})).toEqual({ since: null, before: null });
    expect(jstRangeOf({ from: '2026-04-01' })).toEqual({ since: '2026-04-01T00:00:00+09:00', before: null });
  });
});

describe('toQueryString / hasAnyFilter', () => {
  it('空の条件は付けない。キーの順は固定（条件が同じなら同じ文字になる）', () => {
    expect(toQueryString({})).toBe('');
    expect(toQueryString({ q: ' ', source: undefined })).toBe('');
    expect(toQueryString({ q: '営業', from: '2026-04-01' })).toBe(toQueryString({ from: '2026-04-01', q: '営業' }));
    expect(toQueryString({ source: 'db' }, { cursor: '10', limit: 20, skipped: null })).toBe('source=db&cursor=10&limit=20');
  });

  it('作った文字は、検証を通って元の条件に戻る', () => {
    const filters = { from: '2026-04-01', to: '2026-04-30', source: 'app', category: 'other', q: 'a&b=c,d(e)' } as const;
    expect(parseAuditLogFilters(query(toQueryString(filters)))).toEqual({ ok: true, value: filters });
  });

  it('条件が 1 つでもあれば true', () => {
    expect(hasAnyFilter({})).toBe(false);
    expect(hasAnyFilter({ q: '  ' })).toBe(false);
    expect(hasAnyFilter({ requestId: 'r' })).toBe(true);
  });
});

describe('quoteFilterValue / containsPattern', () => {
  it('PostgREST の or=(…) の区切り（, . : ( )）が値の中にあっても、1 つの値として読まれるように引用符で囲む', () => {
    expect(quoteFilterValue('auth.*')).toBe('"auth.*"');
    expect(quoteFilterValue('a,b)')).toBe('"a,b)"');
  });

  it('引用符と \\ は打ち消す（値の途中で引用が閉じない）', () => {
    expect(quoteFilterValue('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteFilterValue('a\\b')).toBe('"a\\\\b"');
    expect(quoteFilterValue('",id.neq.x,"')).toBe('"\\",id.neq.x,\\""');
  });

  it('キーワードの % と _ は、任意の文字ではなくその文字として探す', () => {
    expect(containsPattern('営業')).toBe('*営業*');
    expect(containsPattern('50%')).toBe('*50\\%*');
    expect(containsPattern('a_b')).toBe('*a\\_b*');
    expect(containsPattern('a\\b')).toBe('*a\\\\b*');
  });
});

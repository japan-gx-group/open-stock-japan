import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { AUDIT_LOG_CSV_HEADER } from '../csv';
import type { AuditCursor } from '../filters';
import { applyAuditLogFilters, AuditLogQueryError, countAuditLogs, exportAuditLogs, fetchAuditLogRows, getAuditLogDetail, listAuditLogs } from '../logs.server';

// 監査ログの読み出しが、必ず自組織の行だけを返すこと、連番の降順 → 連番なしの順で最後まで読めること、
// CSV の出力が上限で止まり、読み落としを黙って渡さないことを確かめる。
// DB の代わりに、使っている操作（eq / is / not / lt / gte / in / order / limit / range）だけを持つ簡単な代役を使う。

type Row = Record<string, unknown>;

const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER_ORG = '22222222-2222-2222-2222-222222222222';
const USER = 'aaaaaaaa-0000-0000-0000-000000000001';
const STAKEHOLDER = '50000000-0000-0000-0000-000000000007';

const likeToRegExp = (pattern: string): RegExp =>
  new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/[*%]/g, '.*').replace(/_/g, '.')}$`);

const compare = (a: unknown, b: unknown): number => {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};

class FakeQuery implements PromiseLike<{ data: unknown; error: null; count: number | null }> {
  private readonly filters: ((row: Row) => boolean)[] = [];
  private readonly orders: { column: string; ascending: boolean }[] = [];
  private window: { from: number; to: number } | null = null;

  constructor(
    private readonly table: string,
    private readonly rows: Row[],
    private readonly options: { count?: string; head?: boolean } | undefined,
    private readonly calls: string[],
    private readonly maxRows: number,
  ) {}

  eq(column: string, value: unknown): this {
    this.calls.push(`${this.table}:eq:${column}=${String(value)}`);
    this.filters.push((row) => row[column] === value);
    return this;
  }

  is(column: string, value: null): this {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    this.calls.push(`${this.table}:not:${column}.${operator}.${String(value)}`);
    if (operator === 'is') this.filters.push((row) => row[column] != null);
    if (operator === 'like') this.filters.push((row) => !likeToRegExp(String(value)).test(String(row[column])));
    return this;
  }

  lt(column: string, value: string | number): this {
    this.filters.push((row) => (typeof value === 'number' ? Number(row[column]) < value : Date.parse(String(row[column])) < Date.parse(value)));
    return this;
  }

  gte(column: string, value: string): this {
    this.filters.push((row) => Date.parse(String(row[column])) >= Date.parse(value));
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }

  // or=(…) の中身は PostgREST が読む。ここでは渡された文字だけを残す
  or(filters: string): this {
    this.calls.push(`${this.table}:or:${filters}`);
    return this;
  }

  order(column: string, options: { ascending: boolean }): this {
    this.orders.push({ column, ascending: options.ascending });
    return this;
  }

  limit(count: number): this {
    this.window = { from: 0, to: count - 1 };
    return this;
  }

  range(from: number, to: number): this {
    this.window = { from, to };
    return this;
  }

  then<A, B>(
    resolve?: ((value: { data: unknown; error: null; count: number | null }) => A | PromiseLike<A>) | null,
    reject?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let matched = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    for (const order of [...this.orders].reverse()) {
      matched = [...matched].sort((a, b) => (order.ascending ? 1 : -1) * compare(a[order.column], b[order.column]));
    }
    const count = matched.length;
    if (this.window) matched = matched.slice(this.window.from, this.window.to + 1);
    // PostgREST の 1 回あたりの行数の上限（max_rows）
    matched = matched.slice(0, this.maxRows);
    const result = { data: this.options?.head ? null : matched, error: null, count: this.options?.count ? count : null };
    return Promise.resolve(result).then(resolve, reject);
  }
}

const fakeAdmin = (tables: Record<string, Row[]>, maxRows = 1000) => {
  const calls: string[] = [];
  const admin = {
    from: (table: string) => ({
      select: (_columns: string, options?: { count?: string; head?: boolean }) => new FakeQuery(table, tables[table] ?? [], options, calls, maxRows),
    }),
  } as unknown as SupabaseClient;
  return { admin, calls };
};

const logRow = (seq: number | null, extra: Row = {}): Row => ({
  id: `00000000-0000-0000-0000-${String(seq ?? 0).padStart(12, '0')}`,
  organizationId: ORG,
  userId: USER,
  action: 'auth.login',
  entityName: 'auth.sessions',
  entityId: null,
  detail: null,
  ipAddress: '203.0.113.9',
  userAgent: 'test',
  requestId: null,
  createdAt: `2026-11-11T04:00:${String(seq ?? 0).padStart(2, '0')}.000000+00:00`,
  seq,
  prevHash: seq == null ? null : `prev-${seq}`,
  hash: seq == null ? null : `hash-${seq}`,
  source: 'auth',
  outcome: 'success',
  actorEmail: 'admin@example.com',
  actorRole: 'admin',
  oldValues: null,
  newValues: null,
  oldValuesText: null,
  newValuesText: null,
  ...extra,
});

/** 連番 1〜count の記録と、連番なしの記録 legacy 件、それに別の組織の記録を 2 件 */
const dataset = (count: number, legacy = 0): Row[] => [
  ...Array.from({ length: count }, (_, index) => logRow(index + 1)),
  ...Array.from({ length: legacy }, (_, index) =>
    logRow(null, { id: `0000000${index}-aaaa-0000-0000-000000000000`, createdAt: `2026-11-10T00:00:0${index}.000000+00:00`, actorEmail: null, actorRole: null }),
  ),
  logRow(900, { organizationId: OTHER_ORG, id: '99999999-0000-0000-0000-000000000900' }),
  logRow(null, { organizationId: OTHER_ORG, id: '99999999-0000-0000-0000-000000000000' }),
];

const readAll = async (admin: SupabaseClient, limit: number): Promise<{ seq: number | null; id: string }[]> => {
  type Entry = { seq: number | null; id: string };
  const all: Entry[] = [];
  let cursor: AuditCursor | null = null;
  for (let guard = 0; guard < 100; guard += 1) {
    const page: { rows: Entry[]; nextCursor: AuditCursor | null } = await fetchAuditLogRows<Entry>(admin, ORG, {}, cursor, limit, 'id, seq');
    expect(page.rows.length).toBeLessThanOrEqual(limit);
    all.push(...page.rows);
    cursor = page.nextCursor;
    if (!cursor) return all;
  }
  throw new Error('終わらない');
};

describe('fetchAuditLogRows', () => {
  it('連番の降順で読み、連番つきを読み切ったら連番なし（新しい順）を続ける。重複も抜けも無い', async () => {
    const { admin } = fakeAdmin({ system_audit_logs: dataset(7, 3) });
    for (const limit of [1, 2, 3, 4, 7, 9, 10, 50]) {
      const all = await readAll(admin, limit);
      expect(all.map((row) => row.seq)).toEqual([7, 6, 5, 4, 3, 2, 1, null, null, null]);
      expect(new Set(all.map((row) => row.id)).size).toBe(10);
      // 連番なしは、記録時刻の新しい順
      expect(all.slice(7).map((row) => row.id[7])).toEqual(['2', '1', '0']);
    }
  });

  it('続きが無ければ nextCursor は null（ちょうど 1 ページぶんのときも、空のページを読ませない）', async () => {
    const { admin } = fakeAdmin({ system_audit_logs: dataset(4) });
    const page = await fetchAuditLogRows<{ seq: number | null }>(admin, ORG, {}, null, 4, 'id, seq');
    expect(page.rows).toHaveLength(4);
    expect(page.nextCursor).toBeNull();
    const next = await fetchAuditLogRows<{ seq: number | null }>(admin, ORG, {}, null, 3, 'id, seq');
    expect(next.nextCursor).toEqual({ kind: 'seq', before: 2 });
  });

  it('別の組織の記録は返さない', async () => {
    const { admin, calls } = fakeAdmin({ system_audit_logs: dataset(3, 1) });
    const all = await readAll(admin, 2);
    expect(all).toHaveLength(4);
    expect(all.some((row) => row.id.startsWith('99999999'))).toBe(false);
    // どの問い合わせにも、組織での絞り込みが付いている
    expect(calls.filter((call) => call.startsWith('system_audit_logs:eq:organizationId=')).every((call) => call.endsWith(ORG))).toBe(true);
    expect(await countAuditLogs(admin, ORG, {})).toBe(4);
  });
});

describe('applyAuditLogFilters', () => {
  const record = (filters: Parameters<typeof applyAuditLogFilters>[2]): string[] => {
    const { admin, calls } = fakeAdmin({});
    const query = (admin.from('system_audit_logs') as unknown as { select(columns: string): FakeQuery }).select('id');
    applyAuditLogFilters(query, ORG, filters);
    return calls;
  };

  it('条件が無くても、組織では必ず絞る', () => {
    expect(record({})).toEqual([`system_audit_logs:eq:organizationId=${ORG}`]);
  });

  it('種類は、その種類の操作のパターンのどれかに合うもの（値は引用符で囲む）', () => {
    expect(record({ category: 'auth' })).toContain('system_audit_logs:or:action.like."auth.*",action.like."access.*"');
  });

  it('「その他」は、どの種類のパターンにも合わないもの', () => {
    const calls = record({ category: 'other' });
    expect(calls).toContain('system_audit_logs:not:action.like.auth.*');
    expect(calls).toContain('system_audit_logs:not:action.like.audit_log.*');
    expect(calls.some((call) => call.includes(':or:'))).toBe(false);
  });

  it('キーワードは、区切りの文字（, . ( ) "）が入っていても 1 つの値として渡す', () => {
    const calls = record({ q: 'a,b.c("d")' });
    const or = calls.find((call) => call.includes(':or:')) ?? '';
    expect(or).toContain('action.ilike."*a,b.c(\\"d\\")*"');
    expect(or).toContain('detail.ilike."*a,b.c(\\"d\\")*"');
    expect(or).toContain('actorEmail.ilike.');
    expect(or).toContain('ipAddress.ilike.');
  });

  it('キーワードが操作の表示名に合えば、その操作も対象にする', () => {
    const or = record({ q: 'ログアウト' }).find((call) => call.includes(':or:')) ?? '';
    expect(or).toContain('action.in.("auth.logout")');
  });

  it('対象・リクエスト・記録元・結果は、同じ値のものだけ', () => {
    const calls = record({ entityName: 'stakeholders', entityId: STAKEHOLDER, requestId: 'req-1', source: 'db', outcome: 'denied', userId: USER });
    expect(calls).toEqual(
      expect.arrayContaining([
        'system_audit_logs:eq:entityName=stakeholders',
        `system_audit_logs:eq:entityId=${STAKEHOLDER}`,
        'system_audit_logs:eq:requestId=req-1',
        'system_audit_logs:eq:source=db',
        'system_audit_logs:eq:outcome=denied',
        `system_audit_logs:eq:userId=${USER}`,
      ]),
    );
  });
});

describe('絞り込みの結果（期間・操作した人・その他）', () => {
  const rows = [
    logRow(1, { createdAt: '2026-03-31T14:59:59.999999+00:00' }), // 日本時間 3/31 23:59
    logRow(2, { createdAt: '2026-03-31T15:00:00.000000+00:00' }), // 日本時間 4/1 0:00
    logRow(3, { createdAt: '2026-04-30T14:59:59.999999+00:00', userId: null }), // 日本時間 4/30 23:59
    logRow(4, { createdAt: '2026-04-30T15:00:00.000000+00:00', action: 'something.new' }), // 日本時間 5/1 0:00
  ];

  it('期間は日本時間の日付で、終わりの日を含む', async () => {
    const { admin } = fakeAdmin({ system_audit_logs: rows });
    const page = await fetchAuditLogRows<{ seq: number }>(admin, ORG, { from: '2026-04-01', to: '2026-04-30' }, null, 10, 'id, seq');
    expect(page.rows.map((row) => row.seq)).toEqual([3, 2]);
  });

  it("操作した人の 'system' は、操作した人が空の記録だけ", async () => {
    const { admin } = fakeAdmin({ system_audit_logs: rows });
    const page = await fetchAuditLogRows<{ seq: number }>(admin, ORG, { userId: 'system' }, null, 10, 'id, seq');
    expect(page.rows.map((row) => row.seq)).toEqual([3]);
  });

  it('「その他」は、どの種類にも入らない操作だけ', async () => {
    const { admin } = fakeAdmin({ system_audit_logs: rows });
    const page = await fetchAuditLogRows<{ seq: number }>(admin, ORG, { category: 'other' }, null, 10, 'id, seq');
    expect(page.rows.map((row) => row.seq)).toEqual([4]);
  });
});

describe('listAuditLogs / getAuditLogDetail', () => {
  const tables = {
    system_audit_logs: [
      logRow(1, { action: 'stakeholders.update', entityName: 'stakeholders', entityId: STAKEHOLDER, source: 'db', oldValues: { notes: '前', updatedAt: 'x' }, newValues: { notes: '後', updatedAt: 'y' } }),
      logRow(2, { action: 'stakeholders.update', entityName: 'stakeholders', entityId: STAKEHOLDER, source: 'app', detail: '{"label":"アプリが残した名前","changed":["notes"]}' }),
      logRow(3, { action: 'stakeholders.delete', entityName: 'stakeholders', entityId: '50000000-0000-0000-0000-00000000dead', source: 'db', oldValues: { id: 'x', name: '消した人' } }),
      logRow(4, { action: 'ai.request', entityName: 'draft_writing', source: 'app', userId: null, actorEmail: null, actorRole: null }),
      logRow(5, { userId: 'aaaaaaaa-0000-0000-0000-00000000gone', actorEmail: 'gone@example.com', actorRole: 'logger' }),
      logRow(800, { organizationId: OTHER_ORG, id: '99999999-0000-0000-0000-000000000800' }),
    ],
    profiles: [
      { id: USER, organizationId: ORG, fullName: '創業 太郎', email: 'admin@example.com' },
      { id: USER, organizationId: OTHER_ORG, fullName: '別の組織の人', email: 'x@example.com' },
    ],
    stakeholders: [
      { id: STAKEHOLDER, organizationId: ORG, name: '営業 花子' },
      { id: STAKEHOLDER, organizationId: OTHER_ORG, name: '別の組織の株主' },
    ],
  };

  it('一覧は、操作した人の氏名と対象の名前を補い、値の中身は返さない', async () => {
    const { admin, calls } = fakeAdmin(tables);
    const { items, nextCursor } = await listAuditLogs(admin, ORG, {}, null, 50);
    expect(nextCursor).toBeNull();
    expect(items.map((item) => item.seq)).toEqual([5, 4, 3, 2, 1]);
    const bySeq = Object.fromEntries(items.map((item) => [item.seq, item]));

    // データの変更: 名前はいまのテーブルから（自組織の行だけ）。変わった列の名前だけを返す
    expect(bySeq[1]).toMatchObject({ entityLabel: '営業 花子', actorName: '創業 太郎', changedColumns: ['notes'] });
    // アプリの操作: アプリが残した名前と項目を使う
    expect(bySeq[2]).toMatchObject({ entityLabel: 'アプリが残した名前', changedColumns: ['notes'] });
    // 削除: 行はもう無いので、記録の中の名前を使う。行の全体は「変更した項目」にしない
    expect(bySeq[3]).toMatchObject({ entityLabel: '消した人', changedColumns: [] });
    // AI の利用: 用途の名前
    expect(bySeq[4]).toMatchObject({ entityLabel: '文章の下書き', userId: null, actorName: null });
    // 削除済みのアカウント: 氏名は無いが、当時のメールアドレスとロールは残る
    expect(bySeq[5]).toMatchObject({ actorName: null, actorEmail: 'gone@example.com', actorRole: 'logger' });

    for (const item of items) {
      expect(item).not.toHaveProperty('oldValues');
      expect(item).not.toHaveProperty('newValues');
      expect(item).not.toHaveProperty('hash');
    }
    // 名前を補う問い合わせも、組織で絞っている
    expect(calls).toContain(`profiles:eq:organizationId=${ORG}`);
    expect(calls).toContain(`stakeholders:eq:organizationId=${ORG}`);
    expect(JSON.stringify(items)).not.toContain('別の組織');
  });

  it('詳細は、変更前後の値・ハッシュまで返す', async () => {
    const { admin } = fakeAdmin(tables);
    const detail = await getAuditLogDetail(admin, ORG, '00000000-0000-0000-0000-000000000001');
    expect(detail).toMatchObject({
      seq: 1,
      entityLabel: '営業 花子',
      hash: 'hash-1',
      prevHash: 'prev-1',
      userAgent: 'test',
      oldValues: { notes: '前', updatedAt: 'x' },
      newValues: { notes: '後', updatedAt: 'y' },
    });
  });

  it('別の組織の記録・形の違う id は、見つからないものとして扱う', async () => {
    const { admin } = fakeAdmin(tables);
    expect(await getAuditLogDetail(admin, ORG, '99999999-0000-0000-0000-000000000800')).toBeNull();
    expect(await getAuditLogDetail(admin, ORG, 'not-a-uuid')).toBeNull();
    expect(await getAuditLogDetail(admin, ORG, '00000000-0000-0000-0000-00000000ffff')).toBeNull();
  });
});

describe('exportAuditLogs', () => {
  const decode = (chunks: Uint8Array[]): string => new TextDecoder('utf-8', { ignoreBOM: true }).decode(Buffer.concat(chunks));

  it('条件に合う記録を、見出しつきの CSV にする（新しい順。ページをまたいでも抜けない）', async () => {
    const { admin } = fakeAdmin({ system_audit_logs: dataset(1203, 2) });
    const result = await exportAuditLogs(admin, ORG, {});
    expect(result).toMatchObject({ rowCount: 1205, totalCount: 1205, truncated: false, lastSeq: 1203, lastHash: 'hash-1203', firstSeq: 1 });
    const text = decode(result.chunks);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).split('\r\n');
    expect(lines[0]).toBe(AUDIT_LOG_CSV_HEADER.join(','));
    expect(lines).toHaveLength(1205 + 2); // 見出し + 行 + 末尾の空
    expect(lines[1].startsWith('1203,')).toBe(true);
    expect(lines[1203].startsWith('1,')).toBe(true);
    expect(lines[1204].startsWith(',')).toBe(true); // 連番なし
    expect(result.byteLength).toBe(result.chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    expect(text).not.toContain(OTHER_ORG);
  });

  it('上限を超える分は出さず、打ち切ったことを返す（出した中でいちばん新しい連番とハッシュつき）', async () => {
    const { admin } = fakeAdmin({ system_audit_logs: dataset(30, 2) });
    const result = await exportAuditLogs(admin, ORG, {}, 10);
    expect(result).toMatchObject({ rowCount: 10, totalCount: 32, truncated: true, lastSeq: 30, lastHash: 'hash-30', firstSeq: 21 });
    expect(decode(result.chunks).slice(1).split('\r\n')).toHaveLength(10 + 2);
  });

  it('ちょうど上限の件数なら、打ち切りではない', async () => {
    const { admin } = fakeAdmin({ system_audit_logs: dataset(10) });
    expect(await exportAuditLogs(admin, ORG, {}, 10)).toMatchObject({ rowCount: 10, totalCount: 10, truncated: false });
  });

  it('記録が無ければ、見出しだけの CSV', async () => {
    const { admin } = fakeAdmin({ system_audit_logs: [] });
    const result = await exportAuditLogs(admin, ORG, {});
    expect(result).toMatchObject({ rowCount: 0, totalCount: 0, truncated: false, lastSeq: null, lastHash: null, firstSeq: null });
    expect(decode(result.chunks)).toBe(`\uFEFF${AUDIT_LOG_CSV_HEADER.join(',')}\r\n`);
  });

  it('DB が 1 回に返す行数を絞っていて読み落としたときは、欠けた CSV を渡さずに失敗にする', async () => {
    const { admin } = fakeAdmin({ system_audit_logs: dataset(50) }, 20);
    await expect(exportAuditLogs(admin, ORG, {})).rejects.toBeInstanceOf(AuditLogQueryError);
  });
});

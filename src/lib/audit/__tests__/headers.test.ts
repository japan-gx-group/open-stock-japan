import { describe, expect, it } from 'vitest';
import {
  auditContextFromHeaders,
  DB_ACTOR_HEADER,
  DB_IP_HEADER,
  DB_REQUEST_ID_HEADER,
  DB_USER_AGENT_HEADER,
  INTERNAL_HEADERS,
  PATH_HEADER,
  PROXY_MARK_HEADER,
  proxyMarkOf,
  toDbAuditHeaders,
  USER_ID_HEADER,
} from '../headers';

// 監査ログの「だれが・どこから」を、リクエストのヘッダから取り出して DB へ渡すところを確かめる。

const headersOf = (values: Record<string, string>) => new Headers(values);
const USER_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

describe('auditContextFromHeaders', () => {
  it('プロキシが入れた本人の id・接続元・リクエストの番号・操作を取り出す', () => {
    const context = auditContextFromHeaders(
      headersOf({
        [USER_ID_HEADER]: USER_ID,
        // 左は利用者が書ける値、右が手前のプロキシが足した接続元
        'x-forwarded-for': '198.51.100.1, 203.0.113.9',
        'user-agent': 'Mozilla/5.0 (Macintosh)',
        'x-request-id': 'req-1',
        [PATH_HEADER]: 'POST /api/company',
      }),
    );
    expect(context).toEqual({
      actorId: USER_ID,
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (Macintosh)',
      requestId: 'req-1',
      route: 'POST /api/company',
    });
  });

  it('本人の id が UUID の形でなければ使わない（でたらめな値を監査ログに入れない）', () => {
    expect(auditContextFromHeaders(headersOf({ [USER_ID_HEADER]: 'admin' })).actorId).toBeNull();
    expect(auditContextFromHeaders(headersOf({ [USER_ID_HEADER]: `${USER_ID}; drop` })).actorId).toBeNull();
  });

  it('利用者が x-forwarded-for の先頭に書いた値は、接続元として使わない', () => {
    expect(auditContextFromHeaders(headersOf({ 'x-forwarded-for': '1.2.3.4, 203.0.113.9' })).ip).toBe('203.0.113.9');
  });

  it('x-forwarded-for が無ければ x-real-ip を使い、どちらも無ければ空にする', () => {
    expect(auditContextFromHeaders(headersOf({ 'x-real-ip': '198.51.100.7' })).ip).toBe('198.51.100.7');
    expect(auditContextFromHeaders(headersOf({})).ip).toBeNull();
  });

  it('ヘッダに入れられない文字を落とし、長さを切る', () => {
    // Headers は ASCII 以外の値を受け付けないので、get だけを持つ入れ物で確かめる
    const raw = { get: (name: string) => (name === 'user-agent' ? `ブラウザ\u0007 ${'a'.repeat(600)}` : null) };
    const context = auditContextFromHeaders(raw);
    expect(context.userAgent).toHaveLength(500);
    expect(context.userAgent).toMatch(/^a+$/);
  });
});

describe('プロキシを通っていないリクエスト', () => {
  it('操作した人と操作（プロキシが入れるはずの値）は使わない。接続元・ブラウザ・リクエストの番号は残す', () => {
    const context = auditContextFromHeaders(
      headersOf({
        [USER_ID_HEADER]: USER_ID,
        [PATH_HEADER]: 'FORGED /not/the/real/route',
        'x-forwarded-for': '203.0.113.9',
        'user-agent': 'UA',
        'x-request-id': 'req-1',
      }),
      { viaProxy: false },
    );
    expect(context).toEqual({ actorId: null, ip: '203.0.113.9', userAgent: 'UA', requestId: 'req-1', route: null });
  });
});

describe('proxyMarkOf', () => {
  it('サーバだけが知る鍵から、毎回同じ印を作る（鍵が違えば印も違う）', async () => {
    const first = await proxyMarkOf('secret-a');
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await proxyMarkOf('secret-a')).toBe(first);
    expect(await proxyMarkOf('secret-b')).not.toBe(first);
  });

  it('印に、鍵そのものは含まれない', async () => {
    expect(await proxyMarkOf('super-secret-service-role-key')).not.toContain('super-secret');
  });

  it('鍵が無ければ印を作らない（＝どのリクエストも、プロキシを通ったとは見なさない）', async () => {
    expect(await proxyMarkOf('')).toBeNull();
  });
});

describe('INTERNAL_HEADERS', () => {
  it('ブラウザから届いたら捨てるヘッダに、本人の id・操作・プロキシの印がすべて入っている', () => {
    expect([...INTERNAL_HEADERS].sort()).toEqual([PATH_HEADER, PROXY_MARK_HEADER, USER_ID_HEADER].sort());
  });
});

describe('toDbAuditHeaders', () => {
  it('値のあるものだけを、DB のトリガーが読む名前で渡す', () => {
    expect(toDbAuditHeaders({ actorId: USER_ID, ip: '203.0.113.9', userAgent: 'UA', requestId: 'req-1', route: 'GET /x' })).toEqual({
      [DB_ACTOR_HEADER]: USER_ID,
      [DB_IP_HEADER]: '203.0.113.9',
      [DB_USER_AGENT_HEADER]: 'UA',
      [DB_REQUEST_ID_HEADER]: 'req-1',
    });
    expect(toDbAuditHeaders({ actorId: null, ip: null, userAgent: null, requestId: null, route: null })).toEqual({});
  });
});

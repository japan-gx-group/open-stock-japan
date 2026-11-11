import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ACCESS_CSV_HEADER,
  accountAccessCsvRows,
  AUDIT_LOG_CSV_HEADER,
  auditLogCsvRow,
  buildCsv,
  CSV_BOM,
  escapeCsvCell,
  neutralizeCell,
  toCsvLine,
  type AuditLogExportRow,
} from '../csv';

describe('neutralizeCell（CSV インジェクションの対策）', () => {
  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tcmd', '\rcmd', '＝1+1', '＋1', '－1', '＠x', "=HYPERLINK(\"http://evil\",\"x\")"])(
    '数式として読まれる文字で始まるセルは、先頭に \' を付ける: %j',
    (value) => {
      expect(neutralizeCell(value)).toBe(`'${value}`);
    },
  );

  it.each(['abc', '1+1', 'a=b', ' =1', '{"a":1}', '営業', '', "'=1"])('それ以外はそのまま: %j', (value) => {
    expect(neutralizeCell(value)).toBe(value);
  });
});

describe('escapeCsvCell', () => {
  it('null・undefined は空、数値はそのまま', () => {
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(undefined)).toBe('');
    expect(escapeCsvCell(0)).toBe('0');
    expect(escapeCsvCell(-12)).toBe('-12');
    expect(escapeCsvCell(Number.NaN)).toBe('');
  });

  it('カンマ・引用符・改行を含む値は引用符で囲み、中の引用符は 2 つ重ねる', () => {
    expect(escapeCsvCell('a,b')).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(escapeCsvCell('line1\r\nline2')).toBe('"line1\r\nline2"');
    expect(escapeCsvCell('plain')).toBe('plain');
  });

  it('数式よけと引用を両方かける', () => {
    expect(escapeCsvCell('=1,2')).toBe('"\'=1,2"');
    expect(escapeCsvCell('-a"b')).toBe('"\'-a""b"');
    // 文字として渡した負の数は、数式よけの対象（数値として渡せばそのまま）
    expect(escapeCsvCell('-5')).toBe("'-5");
  });
});

describe('buildCsv', () => {
  it('先頭に BOM、行は CRLF で終わる', () => {
    const csv = buildCsv([
      ['見出し1', '見出し2'],
      ['a', 1],
    ]);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toBe('﻿見出し1,見出し2\r\na,1\r\n');
  });

  it('UTF-8 にすると、先頭が EF BB BF になる（Excel が UTF-8 として開く）', () => {
    const bytes = new TextEncoder().encode(buildCsv([['a']]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it('toCsvLine は 1 行ぶん（末尾に CRLF）', () => {
    expect(toCsvLine(['a', null, 'b,c'])).toBe('a,,"b,c"\r\n');
  });
});

const ROW: AuditLogExportRow = {
  id: 'be6aa733-d64f-444e-b155-a8d3a0cd388e',
  organizationId: '11111111-1111-1111-1111-111111111111',
  userId: 'aaaaaaaa-0000-0000-0000-000000000002',
  action: 'stakeholders.update',
  entityName: 'stakeholders',
  entityId: '50000000-0000-0000-0000-000000000007',
  detail: null,
  ipAddress: '203.0.113.9',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  requestId: 'req-1',
  createdAt: '2026-11-11T04:03:35.5902+00:00',
  seq: 21,
  prevHash: 'c25310be',
  hash: 'f5d3c2ee',
  source: 'db',
  outcome: 'success',
  actorEmail: 'member@example.com',
  actorRole: 'logger',
  oldValuesText: '{"notes": "前"}',
  newValuesText: '{"notes": "=後, \\"引用\\""}',
};

describe('auditLogCsvRow', () => {
  it('見出しと同じ数の列を、見出しの順に出す', () => {
    expect(auditLogCsvRow(ROW)).toHaveLength(AUDIT_LOG_CSV_HEADER.length);
    const byHeader = Object.fromEntries(AUDIT_LOG_CSV_HEADER.map((name, index) => [name, auditLogCsvRow(ROW)[index]]));
    expect(byHeader).toMatchObject({
      連番: 21,
      '日時（UTC）': '2026-11-11T04:03:35.590200Z',
      '日時（日本時間）': '2026/11/11 13:03:35',
      記録元: 'db',
      結果: 'success',
      操作: 'stakeholders.update',
      '操作（表示名）': '株主・権利者を更新（データ）',
      対象の種類: 'stakeholders',
      対象のID: '50000000-0000-0000-0000-000000000007',
      操作した人のID: 'aaaaaaaa-0000-0000-0000-000000000002',
      操作した人のメールアドレス: 'member@example.com',
      操作した人のロール: 'logger',
      IPアドレス: '203.0.113.9',
      リクエストの番号: 'req-1',
      変更前の値: '{"notes": "前"}',
      直前の記録のハッシュ: 'c25310be',
      ハッシュ: 'f5d3c2ee',
      記録のID: ROW.id,
      組織のID: ROW.organizationId,
    });
  });

  it('変更前後の値は、DB が持つ JSON の文字のまま 1 つのセルに入る（カンマ・引用符は CSV の引用で守る）', () => {
    const line = toCsvLine(auditLogCsvRow(ROW));
    expect(line).toContain('"{""notes"": ""前""}"');
    expect(line).toContain('"{""notes"": ""=後, \\""引用\\""""}"');
    expect(line.endsWith('\r\n')).toBe(true);
  });

  it('連番の無い記録（連鎖を入れる前）は、連番・ハッシュの列が空になる', () => {
    const cells = auditLogCsvRow({ ...ROW, seq: null, prevHash: null, hash: null, userId: null, actorEmail: null, actorRole: null });
    expect(toCsvLine(cells).startsWith(',2026-11-11T04:03:35.590200Z,')).toBe(true);
  });

  it('利用者が入れられる値（ブラウザの名前・詳細）が数式の形でも、文字として出る', () => {
    const cells = auditLogCsvRow({ ...ROW, userAgent: '=cmd|\' /C calc\'!A0', detail: '@SUM(1)', actorEmail: '+evil@example.com' });
    const line = toCsvLine(cells);
    expect(line).toContain("'=cmd|' /C calc'!A0");
    expect(line).toContain("'@SUM(1)");
    expect(line).toContain("'+evil@example.com");
    expect(line).not.toMatch(/(^|,)[=+@]/);
  });
});

describe('accountAccessCsvRows', () => {
  const rows = accountAccessCsvRows({
    generatedAt: '2026-11-11T04:00:00.000Z',
    accounts: [
      {
        id: 'u1',
        email: 'admin@example.com',
        fullName: '創業 太郎',
        role: 'admin',
        stakeholderId: null,
        stakeholderName: null,
        createdAt: '2026-01-05T01:00:00+00:00',
        lastSignInAt: '2026-11-10T15:30:00+00:00',
        mfaFactorCount: 1,
        bannedUntil: null,
        status: 'active',
      },
      {
        id: 'u2',
        email: 'holder@example.com',
        fullName: null,
        role: 'shareholder',
        stakeholderId: 's1',
        stakeholderName: '=架空ファンド',
        createdAt: '2026-02-01T00:00:00+00:00',
        lastSignInAt: null,
        mfaFactorCount: 0,
        bannedUntil: null,
        status: 'never',
      },
    ],
    invites: [
      {
        email: 'new@example.com',
        role: 'viewer',
        stakeholderId: null,
        stakeholderName: null,
        invitedByUserId: 'u1',
        invitedByName: '創業 太郎',
        createdAt: '2026-11-01T00:00:00+00:00',
        expiresAt: '2026-11-08T00:00:00+00:00',
        isExpired: true,
      },
    ],
  });

  it('見出し・アカウント・招待の順に並び、どの行も見出しと同じ数の列を持つ', () => {
    expect(rows[0]).toEqual([...ACCOUNT_ACCESS_CSV_HEADER]);
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row).toHaveLength(ACCOUNT_ACCESS_CSV_HEADER.length);
  });

  it('アカウントは、ロールの表示名・日本時間の日時・二要素認証・状態を出す', () => {
    expect(rows[1]).toEqual(['アカウント', '創業 太郎', 'admin@example.com', '管理者', null, '2026/01/05 10:00:00', '2026/11/11 00:30:00', '登録済み', '利用中', '', '', 'u1']);
    expect(rows[2].slice(0, 9)).toEqual(['アカウント', null, 'holder@example.com', '株主', '=架空ファンド', '2026/02/01 09:00:00', '', '未登録', '未ログイン']);
  });

  it('招待は、有効期限と招待した人を出す（招待リンクの秘密の列は無い）', () => {
    expect(rows[3]).toEqual(['招待中', '', 'new@example.com', '閲覧のみ', null, '2026/11/01 09:00:00', '', '', '期限切れ', '2026/11/08 09:00:00', '創業 太郎', '']);
    expect(ACCOUNT_ACCESS_CSV_HEADER.join(',')).not.toMatch(/token|トークン|秘密/);
  });

  it('CSV にすると、数式の形の名前は文字として出る', () => {
    expect(buildCsv(rows)).toContain("'=架空ファンド");
  });
});

import { describe, expect, it } from 'vitest';
import { buildAuditDiff, changedColumnsOf, columnLabel, EMPTY_VALUE_LABEL, formatAuditValue, formatDetailText, summarizeColumns } from '../diff';

describe('columnLabel', () => {
  it('リソース定義の項目名を使う', () => {
    expect(columnLabel('stakeholders', 'name')).toBe('氏名・名称');
    expect(columnLabel('share_transactions', 'shares')).toBe('株式数');
    expect(columnLabel('organizations', 'capitalAmount')).toBe('資本金の額');
  });

  it('定義に無いテーブル・共通の列にも名前を付ける', () => {
    expect(columnLabel('profiles', 'role')).toBe('ロール');
    expect(columnLabel('documents', 'visibility')).toBe('公開範囲');
    expect(columnLabel('share_links', 'expiresAt')).toBe('有効期限');
    expect(columnLabel('stakeholders', 'updatedAt')).toBe('更新日時');
    expect(columnLabel('share_transactions', 'groupId')).toBe('まとめて記録した異動の番号');
  });

  it('分からない列・テーブルは、列の名前をそのまま返す', () => {
    expect(columnLabel('stakeholders', 'brandNewColumn')).toBe('brandNewColumn');
    expect(columnLabel('new_table', 'something')).toBe('something');
    expect(columnLabel('constructor', 'toString')).toBe('toString');
  });
});

describe('formatAuditValue', () => {
  it('空の値は「（空）」', () => {
    expect(formatAuditValue(null)).toBe(EMPTY_VALUE_LABEL);
    expect(formatAuditValue(undefined)).toBe(EMPTY_VALUE_LABEL);
    expect(formatAuditValue('')).toBe(EMPTY_VALUE_LABEL);
  });

  it('真偽・数値・文字', () => {
    expect(formatAuditValue(true)).toBe('はい');
    expect(formatAuditValue(false)).toBe('いいえ');
    expect(formatAuditValue(0)).toBe('0');
    expect(formatAuditValue(1500000)).toBe('1500000');
    expect(formatAuditValue('東京都架空区')).toBe('東京都架空区');
    expect(formatAuditValue('（秘匿）')).toBe('（秘匿）');
  });

  it('選択肢の項目は「表示名（保存されている値）」。知らない値はそのまま', () => {
    const column = { label: '区分', options: [{ value: 'individual', label: '個人' }] };
    expect(formatAuditValue('individual', column)).toBe('個人（individual）');
    expect(formatAuditValue('unknown', column)).toBe('unknown');
  });

  it('率は % を添える', () => {
    expect(formatAuditValue(0.2, { label: '割引率', type: 'percent' })).toBe('20%（0.2）');
    expect(formatAuditValue(0.075, { label: '割引率', type: 'percent' })).toBe('7.5%（0.075）');
  });

  it('長い値の省略の印は、文字数とハッシュを出す', () => {
    const text = formatAuditValue({ omitted: true, length: 12345, sha256: 'abc123' });
    expect(text).toContain('12,345 文字');
    expect(text).toContain('abc123');
  });

  it('そのほかのオブジェクト・配列は JSON の文字にする', () => {
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
    expect(formatAuditValue(['x', 'y'])).toBe('["x","y"]');
  });
});

describe('buildAuditDiff', () => {
  it('変更前後のどちらも無ければ null', () => {
    expect(buildAuditDiff('stakeholders', null, null)).toBeNull();
    expect(buildAuditDiff('stakeholders', undefined, undefined)).toBeNull();
  });

  it('更新: 変わった項目を、日本語名つきで変更前・変更後に並べる', () => {
    const diff = buildAuditDiff('stakeholders', { address: '', kind: 'individual' }, { address: '東京都架空区', kind: 'corporation' });
    expect(diff).toEqual({
      kind: 'update',
      rows: [
        { column: 'kind', label: '区分', before: '個人（individual）', after: '法人（corporation）' },
        { column: 'address', label: '住所', before: EMPTY_VALUE_LABEL, after: '東京都架空区' },
      ],
    });
  });

  it('追加: 変更前は無し（null）。項目は定義の順、管理用の列（id・作成日時など）は最後', () => {
    const diff = buildAuditDiff('stakeholders', null, {
      updatedAt: '2026-11-11T00:00:00Z',
      id: 'x',
      organizationId: 'o',
      zzzNew: 1,
      email: 'a@example.com',
      name: '営業 花子',
      createdAt: '2026-11-11T00:00:00Z',
    });
    expect(diff?.kind).toBe('insert');
    expect(diff?.rows.map((row) => row.column)).toEqual(['name', 'email', 'zzzNew', 'id', 'organizationId', 'createdAt', 'updatedAt']);
    expect(diff?.rows.every((row) => row.before === null)).toBe(true);
    expect(diff?.rows[0]).toEqual({ column: 'name', label: '氏名・名称', before: null, after: '営業 花子' });
    expect(diff?.rows[2].label).toBe('zzzNew');
  });

  it('削除: 変更後は無し（null）', () => {
    const diff = buildAuditDiff('officers', { name: '監査 三郎', isOutside: true }, null);
    expect(diff?.kind).toBe('delete');
    expect(diff?.rows).toEqual([
      { column: 'name', label: '氏名', before: '監査 三郎', after: null },
      { column: 'isOutside', label: '社外役員', before: 'はい', after: null },
    ]);
  });

  it('片方にしか無い列（null から値、値から null）も行にする', () => {
    const diff = buildAuditDiff('stakeholders', { phone: null }, { phone: '03-0000-0000', notes: 'メモ' });
    expect(diff?.rows).toEqual([
      { column: 'phone', label: '電話番号', before: EMPTY_VALUE_LABEL, after: '03-0000-0000' },
      { column: 'notes', label: 'メモ', before: EMPTY_VALUE_LABEL, after: 'メモ' },
    ]);
  });

  it('秘密の値・長い値の印をそのまま読める形で出す', () => {
    const diff = buildAuditDiff('invites', null, { token: '（秘匿）', email: 'a@example.com', role: 'viewer' });
    expect(diff?.rows.find((row) => row.column === 'token')).toEqual({ column: 'token', label: '招待リンクの秘密', before: null, after: '（秘匿）' });
    expect(diff?.rows.find((row) => row.column === 'role')?.after).toBe('閲覧のみ（viewer）');
    const long = buildAuditDiff('meetings', { minutesBody: { omitted: true, length: 9000, sha256: 'ff' } }, { minutesBody: '短い本文' });
    expect(long?.rows[0].before).toContain('9,000 文字');
  });

  it('知らないテーブルでも、列の名前のまま表にする', () => {
    expect(buildAuditDiff('new_table', { a: 1 }, { a: 2 })).toEqual({ kind: 'update', rows: [{ column: 'a', label: 'a', before: '1', after: '2' }] });
  });

  it('オブジェクトでない値（配列・文字）は無いものとして扱う', () => {
    expect(buildAuditDiff('stakeholders', [] as unknown as Record<string, unknown>, 'x' as unknown as Record<string, unknown>)).toBeNull();
  });
});

describe('changedColumnsOf / summarizeColumns', () => {
  it('変更前後に出てくる列の名前（管理用の列は除く）', () => {
    expect(changedColumnsOf({ notes: 'a', updatedAt: 'x' }, { notes: 'b', address: 'c', id: '1' })).toEqual(['notes', 'address']);
    expect(changedColumnsOf(null, null)).toEqual([]);
  });

  it('日本語名にして、定義の順に並べる。多いときは「ほか n 項目」', () => {
    expect(summarizeColumns('stakeholders', ['notes', 'name'])).toBe('氏名・名称、メモ');
    expect(summarizeColumns('stakeholders', ['notes', 'address', 'email', 'name', 'phone'])).toBe('氏名・名称、住所、メールアドレス ほか 2 項目');
    expect(summarizeColumns('stakeholders', [])).toBe('');
    expect(summarizeColumns('new_table', ['b', 'a'])).toBe('a、b');
  });
});

describe('formatDetailText', () => {
  it('JSON は字下げして読みやすくする。JSON でなければそのまま、無ければ空', () => {
    expect(formatDetailText('{"label":"営業 花子","changed":["notes"]}')).toBe('{\n  "label": "営業 花子",\n  "changed": [\n    "notes"\n  ]\n}');
    expect(formatDetailText('ただの文字')).toBe('ただの文字');
    expect(formatDetailText(null)).toBe('');
    expect(formatDetailText('')).toBe('');
  });
});

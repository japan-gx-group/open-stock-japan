// public スキーマの default privileges に対する回帰テスト（実DBを使わない机上検証）。
//
// 検証対象: 20261111000001_rls.sql §4 の `alter default privileges … revoke`。
//   Supabase は postgres ロールに default privileges を設定していて、public に作られる
//   テーブル・シーケンス・関数へ anon / authenticated / service_role の ALL が自動で付く。
//   `revoke all on all tables` は「今あるテーブル」しか剥がせないため、これを消しておかないと
//   あとのマイグレーションでテーブルを追加したときに、そのまま anon への全権限付与になり、
//   RLS と GRANT の二重の防御のうち GRANT 側が外れる。
//   あわせて service_role への自動付与が残っていることも確認する
//   （サーバ専用ロールで、ここまで剥がすと新テーブルが service_role から触れなくなる）。

import { describe, expect, it } from 'vitest';
import { collapseSql, readMigration } from './migrationSql';

const body = collapseSql(readMigration('rls'));

/** `alter default privileges …;` を 1 文ずつ取り出す */
const alterDefaultPrivileges = body.match(/alter default privileges[^;]*;/g) ?? [];

describe('default privileges の既定拒否', () => {
  it.each(['tables', 'sequences', 'functions'])(
    'public の新規 %s を anon / authenticated から剥奪する',
    (objectType) => {
      expect(body).toContain(
        `alter default privileges for role postgres in schema public revoke all on ${objectType} from anon, authenticated;`,
      );
    },
  );

  it('剥奪はロールとスキーマを明示する', () => {
    // ロールを省略すると適用者、スキーマを省略すると全スキーマに依存して結果が変わる。
    // マイグレーションを流すのは postgres で、アプリのオブジェクトは public にしかない。
    const revokes = alterDefaultPrivileges.filter((statement) => statement.includes('revoke'));
    expect(revokes).toHaveLength(3);
    for (const statement of revokes) {
      expect(statement).toContain('for role postgres in schema public');
    }
  });

  it('service_role からは剥奪しない', () => {
    for (const statement of alterDefaultPrivileges.filter((s) => s.includes('revoke'))) {
      expect(statement).not.toContain('service_role');
    }
  });

  it('今あるテーブルからも anon / authenticated の権限をいったんすべて外す', () => {
    expect(body).toContain('revoke all on all tables in schema public from anon, authenticated;');
  });
});

describe('service_role への自動付与', () => {
  it.each([
    'grant select, insert, update, delete on tables to service_role;',
    'grant usage, select on sequences to service_role;',
  ])('%s が残っている', (grantStatement) => {
    expect(body).toContain(`alter default privileges in schema public ${grantStatement}`);
  });
});

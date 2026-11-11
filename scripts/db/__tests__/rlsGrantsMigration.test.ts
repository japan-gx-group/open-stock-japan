// RLS と GRANT の方針（20261111000001_rls.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// - 全テーブルで RLS を有効にする（schema.sql で作ったテーブルを 1 つも漏らさない）
// - anon には何も与えない
// - authenticated に GRANT があるのは、組織・プロフィール・招待・事業年度・AI 設定・監査ログだけ。
//   株主・株式・新株予約権・会議・決算・文書などの業務テーブルには GRANT もポリシーも無い
//   （株主ロールのアカウントが PostgREST を直接叩いても届かない。読み書きはサーバが service_role で行う）
// - 組織の設定の変更と招待は管理者だけ（current_user_is_admin()）
// - 株主ロールは、自分以外のプロフィール・事業年度・AI 設定・監査ログを読めない（current_user_is_internal()）
// - profiles の role / organizationId / email / stakeholderId は本人が書き換えられない

import { describe, expect, it } from 'vitest';
import {
  collapseSql,
  functionDefinition,
  grantsToBrowserRoles,
  policiesOn,
  readMigration,
} from './migrationSql';

const schema = collapseSql(readMigration('schema'));
const rls = collapseSql(readMigration('rls'));

const allTables = [...schema.matchAll(/create table (\w+) \(/g)].map((match) => match[1]);

/** authenticated が直接読める（GRANT とポリシーを持つ）テーブル。増やすときは、株主ロールに見えてよいかを必ず確かめること */
const BROWSER_READABLE_TABLES = [
  'organizations',
  'profiles',
  'invites',
  'fiscal_years',
  'ai_settings',
  'system_audit_logs',
];

const grants = grantsToBrowserRoles(rls);
const grantedTables = (statement: string): string[] => {
  const match = statement.match(/ on (?!schema|function|all )([\w, ]+?) to /);
  return match ? match[1].split(',').map((name) => name.trim()) : [];
};

describe('RLS の有効化', () => {
  it('schema.sql で作ったすべてのテーブルで RLS を有効にしている', () => {
    expect(allTables.length).toBeGreaterThan(20);
    for (const table of allTables) {
      expect(rls, `${table} の RLS が有効になっていません`).toContain(
        `alter table ${table} enable row level security;`,
      );
    }
  });
});

describe('ブラウザ側のロール（anon / authenticated）への GRANT', () => {
  it('anon には何も与えない', () => {
    expect((rls.match(/grant [^;]*;/g) ?? []).filter((statement) => /\banon\b/.test(statement))).toEqual([]);
  });

  it('authenticated にテーブルの権限があるのは、基盤の 6 テーブルだけ', () => {
    const tables = new Set(grants.flatMap(grantedTables));
    expect([...tables].sort()).toEqual([...BROWSER_READABLE_TABLES].sort());
  });

  it('業務テーブルには、authenticated 向けの GRANT もポリシーも無い', () => {
    const businessTables = allTables.filter((table) => !BROWSER_READABLE_TABLES.includes(table));
    expect(businessTables).toEqual(
      expect.arrayContaining(['stakeholders', 'share_transactions', 'option_grants', 'meetings', 'documents', 'ai_credentials']),
    );
    for (const table of businessTables) {
      expect(policiesOn(rls, table), `${table} にポリシーがあります`).toEqual([]);
      expect(
        grants.filter((statement) => grantedTables(statement).includes(table)),
        `${table} に authenticated 向けの GRANT があります`,
      ).toEqual([]);
    }
  });

  it('authenticated が書けるのは、organizations の一部の列・自分の profiles の氏名と電話・招待・監査ログの追記だけ', () => {
    const writes = grants.filter((statement) => /\b(insert|update|delete)\b/.test(statement));
    const writableTables = new Set(writes.flatMap(grantedTables));
    expect([...writableTables].sort()).toEqual(['invites', 'organizations', 'profiles', 'system_audit_logs']);
    expect(rls).toContain('grant update ("fullName", phone) on profiles to authenticated;');
    expect(rls).toContain('grant insert ("organizationId", email, role) on invites to authenticated;');
    expect(rls).toContain('grant select, insert on system_audit_logs to authenticated;');
  });

  it('profiles の role・organizationId・email・stakeholderId は、本人が更新できる列に含めない', () => {
    const profileUpdate = grants.find((statement) => /grant update \(.*\) on profiles /.test(statement)) ?? '';
    for (const column of ['role', 'organizationId', 'email', 'stakeholderId']) {
      expect(profileUpdate).not.toContain(column);
    }
  });

  it('招待に stakeholderId を付けて作るのは、ブラウザからはできない（株主あての招待はサーバが作る）', () => {
    const inviteInsert = grants.find((statement) => /grant insert \(.*\) on invites /.test(statement)) ?? '';
    expect(inviteInsert).not.toContain('stakeholderId');
  });
});

describe('RLS の補助関数', () => {
  it.each([
    'current_user_organization_id',
    'current_user_role',
    'current_user_is_admin',
    'current_user_is_internal',
  ])('%s() は search_path を空にした security definer で、anon からは実行できない', (name) => {
    const fn = functionDefinition(rls, name);
    expect(fn).toMatch(/stable security definer set search_path = ''/);
    expect(rls).toContain(`revoke all on function ${name}() from public, anon, authenticated;`);
    expect(rls).toContain(`grant execute on function ${name}() to authenticated;`);
  });

  it('current_user_is_admin() は、ログイン中の人の role が admin かを返す', () => {
    expect(functionDefinition(rls, 'current_user_is_admin')).toMatch(
      /select exists \(select 1 from public\.profiles p where p\.id = auth\.uid\(\) and p\.role = 'admin'\)/,
    );
  });

  it('current_user_is_internal() は admin・logger・viewer だけを社内とみなす（shareholder は含めない）', () => {
    const fn = functionDefinition(rls, 'current_user_is_internal');
    expect(fn).toContain("p.role in ('admin', 'logger', 'viewer')");
    expect(fn).not.toContain('shareholder');
  });
});

describe('ポリシー', () => {
  it('企業情報の更新と招待は、管理者だけ', () => {
    for (const policy of [
      'organizations_update_own_admin',
      'invites_select_own_organization_admin',
      'invites_insert_own_organization_admin',
      'invites_delete_own_organization_admin',
    ]) {
      const match = rls.match(new RegExp(`create policy "${policy}".*?;`));
      expect(match?.[0], `${policy} が見つかりません`).toContain('current_user_is_admin()');
    }
  });

  it('organizations の作成・削除のポリシーは無い（初回セットアップの service_role だけ）', () => {
    const policies = policiesOn(rls, 'organizations');
    expect(policies).toHaveLength(2);
    expect(policies.some((policy) => /for (insert|delete|all) /.test(policy))).toBe(false);
  });

  it('プロフィールは、社内メンバーなら自組織の全員を、株主ロールなら自分の行だけを読める', () => {
    const [select] = policiesOn(rls, 'profiles').filter((policy) => policy.includes('for select'));
    expect(select).toMatch(
      /using \( id = \(select auth\.uid\(\)\) or \( "organizationId" = \(select current_user_organization_id\(\)\) and \(select current_user_is_internal\(\)\) \) \)/,
    );
  });

  it('プロフィールの更新は自分の行だけで、組織とロールを変えられない', () => {
    const [update] = policiesOn(rls, 'profiles').filter((policy) => policy.includes('for update'));
    expect(update).toContain('using (id = (select auth.uid()))');
    expect(update).toContain('"organizationId" = (select current_user_organization_id())');
    expect(update).toContain('role = (select current_user_role())');
  });

  it.each(['fiscal_years', 'ai_settings'])('%s は、社内メンバーが自組織の分を読めるだけ', (table) => {
    const policies = policiesOn(rls, table);
    expect(policies).toHaveLength(1);
    expect(policies[0]).toMatch(
      /for select to authenticated using \("organizationId" = \(select current_user_organization_id\(\)\) and \(select current_user_is_internal\(\)\)\)/,
    );
    expect(rls).toContain(`grant select on ${table} to authenticated;`);
  });

  it('監査ログは追記専用（更新・削除のポリシーが無い）で、読めるのは社内メンバーだけ', () => {
    const policies = policiesOn(rls, 'system_audit_logs');
    expect(policies).toHaveLength(2);
    expect(policies.some((policy) => /for (update|delete|all) /.test(policy))).toBe(false);
    const select = policies.find((policy) => policy.includes('for select')) ?? '';
    expect(select).toContain('current_user_is_internal()');
  });
});

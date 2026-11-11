// 認証のポリシー（20261111000006_auth_policy.sql）に対する回帰テスト（実 DB を使わない机上検証）。
//
// - 二要素認証を必須にする設定の列が、ブラウザ（authenticated）から書けないこと
// - セッションの判定（current_session_mfa_ok）が、要素の一覧と JWT の aal だけで決まること
// - authenticated が直接読み書きできるテーブルのすべてに、判定を条件にした制限つきポリシーが付いていること
//   （テーブルを足したのにポリシーを付け忘れる、という抜けを見つける）
//
// 実際の動き（コードの確認の前は PostgREST から何も読めない、など）は、ローカルの DB で確かめる。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collapseSql, functionDefinition, grantsToBrowserRoles, policiesOn } from './migrationSql';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations');
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
const all = collapseSql(migrationFiles.map((name) => readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')).join('\n'));
const policy = collapseSql(readFileSync(path.join(MIGRATIONS_DIR, '20261111000006_auth_policy.sql'), 'utf8'));

describe('組織の設定（requireMfaForInternal）', () => {
  it('既定は「必須にしない」。空の値を持たない', () => {
    expect(policy).toContain('alter table organizations add column "requireMfaForInternal" boolean not null default false;');
  });

  it('ブラウザ（authenticated・anon）から書ける列に含めない（変更はサーバが管理者を確かめてから行う）', () => {
    const columnGrants = grantsToBrowserRoles(all).filter((statement) => / on organizations to /.test(statement));
    expect(columnGrants.length).toBeGreaterThan(0);
    for (const statement of columnGrants) {
      expect(statement).not.toContain('requireMfaForInternal');
    }
    // テーブル全体への update の付与も無い（列を限った付与だけ）
    expect(columnGrants.filter((statement) => /grant [^(]*\bupdate\b[^(]* on organizations /.test(statement))).toEqual([]);
  });

  it('このファイルでは、ブラウザ側のロールにテーブルの権限を足さない', () => {
    expect(grantsToBrowserRoles(policy)).toEqual(['grant execute on function current_session_mfa_ok() to authenticated;']);
  });

  it('テーブルは足さない（足すなら、行の変更の記録のトリガーも要る）', () => {
    expect(policy).not.toMatch(/create table /);
  });
});

describe('current_session_mfa_ok()', () => {
  const fn = functionDefinition(policy, 'current_session_mfa_ok');

  it('search_path を空にした security definer で、anon からは実行できない', () => {
    expect(fn).toMatch(/stable security definer set search_path = ''/);
    expect(policy).toContain('revoke all on function current_session_mfa_ok() from public, anon, authenticated;');
    expect(policy).toContain('grant execute on function current_session_mfa_ok() to authenticated;');
  });

  it('確認済みの要素がある人は、JWT の aal が aal2 のときだけ通す', () => {
    expect(fn).toMatch(
      /when exists \( select 1 from auth\.mfa_factors f where f\.user_id = auth\.uid\(\) and f\.status = 'verified' \) then coalesce\(auth\.jwt\(\) ->> 'aal', ''\) = 'aal2'/,
    );
  });

  it('確認済みの要素が無い人は、組織が必須にしていて社内のロールなら通さない（社内の判定は current_user_is_internal に任せる）', () => {
    expect(fn).toMatch(
      /else not \( public\.current_user_is_internal\(\) and exists \( select 1 from public\.organizations o where o\.id = public\.current_user_organization_id\(\) and o\."requireMfaForInternal" \) \)/,
    );
    // ロールの文字列をここに並べない（ロールが増えたときに、ここだけ古いままになる）
    expect(fn).not.toMatch(/'(admin|logger|viewer|auditor|shareholder)'/);
  });
});

describe('制限つきポリシー（…_require_mfa）', () => {
  // authenticated にテーブルの権限がある（＝ PostgREST から直接読み書きできる）テーブル
  const grantedTables = new Set(
    grantsToBrowserRoles(all).flatMap((statement) => {
      const match = statement.match(/ on (?!schema|function|all )([\w, ]+?) to /);
      return match ? match[1].split(',').map((name) => name.trim()) : [];
    }),
  );
  // あとのマイグレーションで権限を取り上げたテーブル（監査ログ）は除く
  const revokedTables = [...all.matchAll(/revoke all on (\w+) from anon, authenticated;/g)].map((match) => match[1]);
  const browserTables = [...grantedTables].filter((table) => !revokedTables.includes(table)).sort();

  it('対象は、組織・プロフィール・招待・事業年度・AI 設定の 5 つ', () => {
    expect(browserTables).toEqual(['ai_settings', 'fiscal_years', 'invites', 'organizations', 'profiles']);
  });

  it('authenticated が直接触れるテーブルのすべてに、読み書き両方を縛るポリシーが付いている', () => {
    const missing = browserTables.filter(
      (table) =>
        !all.includes(
          `create policy "${table}_require_mfa" on ${table} as restrictive for all to authenticated using ((select current_session_mfa_ok())) with check ((select current_session_mfa_ok()));`,
        ),
    );
    // authenticated に GRANT のあるテーブルを足したら、同じ形のポリシーをマイグレーションに足すこと
    expect(missing).toEqual([]);
  });

  it('許可のポリシー（permissive）は足さない（読める範囲を広げない）', () => {
    const created = policy.match(/create policy[^;]*;/g) ?? [];
    expect(created).toHaveLength(5);
    for (const statement of created) {
      expect(statement).toContain(' as restrictive ');
    }
    for (const table of browserTables) {
      expect(policiesOn(policy, table)).toHaveLength(1);
    }
  });
});

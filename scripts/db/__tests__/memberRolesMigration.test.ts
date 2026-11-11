// メンバーのロール（20261111000000_schema.sql のトリガーと 20261111000001_rls.sql の RPC）に対する
// 回帰テスト（実DBを使わない机上検証）。
//
// - ロールは admin / logger / viewer / auditor / shareholder の 5 つ（profiles と invites の check 制約。
//   監査人は 20261111000005_auditor_role.sql で足した）
// - 最後の管理者を守るトリガーは、profiles の role・organizationId の更新と削除の両方に付く
//   （退会は auth.users の削除から連鎖する削除なので、削除にも付いていないと止められない）
// - トリガーは組織ごとのロックを取ってから数える（同時の降格で 0 人にならないように）
// - 組織ごとの削除（organizations からの連鎖）は止めない（デモの seed が組織ごと入れ直す）
// - ロールを変える RPC は service_role 限定で、ロックを取ったあとに操作する人が管理者かを読み直す
// - RPC が書ける値は社内の 4 つ（admin / logger / viewer / auditor）で、株主ロールの行は対象にしない。
//   監査ログを同じトランザクションで残す

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MEMBER_ROLES } from '../../../src/types/role';
import { collapseSql, functionDefinition, readMigration } from './migrationSql';

const schema = collapseSql(readMigration('schema'));
const rls = collapseSql(readMigration('rls'));
// 監査人ロールを足したマイグレーション。check 制約と change_member_role は、ここで定義し直した内容が最終形
const auditorRole = collapseSql(
  readFileSync(path.join(process.cwd(), 'supabase/migrations/20261111000005_auditor_role.sql'), 'utf8'),
);

const lockStatement = `perform pg_advisory_xact_lock(hashtext('organization_admins:' ||`;

describe('ロールの値', () => {
  const roleList = MEMBER_ROLES.map((role) => `'${role}'`).join(', ');

  it('profiles と invites の check 制約が、src/types/role.ts の MEMBER_ROLES と一致する', () => {
    expect(auditorRole).toContain(`alter table profiles add constraint profiles_role_check check (role in (${roleList}));`);
    expect(auditorRole).toContain(`alter table invites add constraint invites_role_check check (role in (${roleList}));`);
  });

  it('profiles と invites は、権利者（stakeholders）への紐づけを任意で持つ', () => {
    expect(schema).toContain(
      'alter table profiles add column "stakeholderId" uuid references stakeholders(id) on delete set null;',
    );
    expect(schema).toContain(
      'alter table invites add column "stakeholderId" uuid references stakeholders(id) on delete cascade;',
    );
  });
});

describe('最後の管理者を守るトリガー', () => {
  it('profiles の role・organizationId の更新と削除の両方の前に付く', () => {
    expect(schema).toContain(
      'create trigger ensure_organization_keeps_admin before update of role, "organizationId" or delete on profiles for each row execute function ensure_organization_keeps_admin();',
    );
  });

  it('組織ごとのロックを取ってから、ほかの管理者がいるかを数え、いなければ P2081 で拒否する', () => {
    const fn = functionDefinition(schema, 'ensure_organization_keeps_admin');
    const lockAt = fn.indexOf(lockStatement);
    const countAt = fn.indexOf(`p.role = 'admin' and p.id <> old.id`);
    expect(lockAt).toBeGreaterThan(-1);
    expect(countAt).toBeGreaterThan(lockAt);
    expect(fn).toMatch(/using errcode = 'P2081'/);
  });

  it('組織そのものが無くなっている（組織ごとの削除）ときは止めない', () => {
    const fn = functionDefinition(schema, 'ensure_organization_keeps_admin');
    expect(fn).toMatch(
      /exists \( select 1 from public\.organizations o where o\.id = old\."organizationId" \) and not exists/,
    );
  });

  it('search_path を空にした security definer（RLS に左右されずに数える）', () => {
    const fn = functionDefinition(schema, 'ensure_organization_keeps_admin');
    expect(fn).toMatch(/security definer set search_path = ''/);
  });
});

describe('ロールを変える RPC（change_member_role）', () => {
  it('EXECUTE は service_role だけ', () => {
    expect(rls).toContain(
      'revoke execute on function change_member_role(uuid, uuid, text) from public, anon, authenticated;',
    );
    expect(rls).toContain('grant execute on function change_member_role(uuid, uuid, text) to service_role;');
    expect(auditorRole).toContain(
      'revoke execute on function change_member_role(uuid, uuid, text) from public, anon, authenticated;',
    );
    expect(auditorRole).toContain('grant execute on function change_member_role(uuid, uuid, text) to service_role;');
  });

  it('書ける値は社内の 4 つのロールだけ（それ以外は P2084）', () => {
    const fn = functionDefinition(auditorRole, 'change_member_role');
    expect(fn).toMatch(/p_role not in \('admin', 'logger', 'viewer', 'auditor'\)/);
    expect(fn).toMatch(/using errcode = 'P2084'/);
  });

  it('いまと同じロールへの変更は何もしない（管理者以外どうしの付け替えは反映する）', () => {
    const fn = functionDefinition(auditorRole, 'change_member_role');
    expect(fn).toContain("if v_previous_role = p_role then return jsonb_build_object('changed', false");
  });

  it('社内のメンバーの判定（current_user_is_internal）に監査人を含める', () => {
    expect(functionDefinition(auditorRole, 'current_user_is_internal')).toContain("p.role in ('admin', 'logger', 'viewer', 'auditor')");
  });

  it('ロックを取ったあとに、操作する人が同じ組織の管理者かを読み直す（P2082）', () => {
    const fn = functionDefinition(auditorRole, 'change_member_role');
    const lockAt = fn.indexOf(lockStatement);
    const actorCheckAt = fn.indexOf(`v_actor_role <> 'admin'`);
    expect(lockAt).toBeGreaterThan(-1);
    expect(actorCheckAt).toBeGreaterThan(lockAt);
    expect(fn).toMatch(/using errcode = 'P2082'/);
  });

  it('対象は操作する人と同じ組織のメンバーに限り、株主ロールの行は対象にしない（P2083）', () => {
    const fn = functionDefinition(auditorRole, 'change_member_role');
    expect(fn).toMatch(/where id = p_target_user_id and "organizationId" = v_organization_id for update/);
    expect(fn).toMatch(/if not found or v_previous_role = 'shareholder' then raise exception [^;]* using errcode = 'P2083'/);
  });

  it('変更を system_audit_logs に member.role.update として残す', () => {
    const fn = functionDefinition(auditorRole, 'change_member_role');
    expect(fn).toMatch(/insert into system_audit_logs .*'member\.role\.update'/);
  });

  it('profiles.role の列 GRANT は無い（本人はロールを変えられない）', () => {
    expect(rls).not.toMatch(/grant update[^;]*\brole\b[^;]* on profiles/);
  });
});

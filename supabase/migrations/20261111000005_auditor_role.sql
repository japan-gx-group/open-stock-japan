-- =====================================================================
-- 監査人（auditor）ロールと、社内のロールの付け替え
--
-- 目的: 職務の分離。監査をする人（内部監査・監査役・外部の監査人）に、
--       「業務データと監査ログを読めるが、何も変えられない」ロールを用意する。
--       あわせて、メンバー管理の画面から、社内の 4 つのロール（管理者・メンバー・閲覧のみ・監査人）を
--       どれでも付けられるようにする（これまでは管理者とメンバーの切り替えだけだった）。
--
--   admin    管理者     すべての操作と組織の設定。監査ログも読める
--   logger   メンバー   業務データの編集
--   viewer   閲覧のみ   業務データの閲覧
--   auditor  監査人     業務データの閲覧と、監査ログ・アカウントの棚卸しの閲覧（編集はできない）
--   shareholder 株主    株主ポータルだけ（このファイルでは変えない）
--
-- 判定の正本は src/types/role.ts と src/lib/authz.ts。ここは DB 側の制約と関数を合わせる。
-- =====================================================================

alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role in ('admin', 'logger', 'viewer', 'auditor', 'shareholder'));

alter table invites drop constraint invites_role_check;
alter table invites add constraint invites_role_check
  check (role in ('admin', 'logger', 'viewer', 'auditor', 'shareholder'));

-- 社内のメンバー（管理者・メンバー・閲覧のみ・監査人）か。株主ロールは false。
create or replace function current_user_is_internal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'logger', 'viewer', 'auditor')
  )
$$;

-- メンバーのロールを、社内の 4 つのロールのどれかに変える。株主ロールの行は対象にしない。
-- 操作する人が同じ組織の管理者であることを確かめ、監査ログを残す。service_role 限定。
-- 管理者が 0 人になる変更は、profiles のトリガー（ensure_organization_keeps_admin）が止める。
create or replace function change_member_role(
  p_actor_id uuid,
  p_target_user_id uuid,
  p_role text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_organization_id uuid;
  v_actor_role text;
  v_previous_role text;
begin
  if p_role is null or p_role not in ('admin', 'logger', 'viewer', 'auditor') then
    raise exception 'ロールの値が正しくありません: %', p_role using errcode = 'P2084';
  end if;

  select "organizationId" into v_organization_id from profiles where id = p_actor_id;
  if not found then
    raise exception '管理者のみロールを変更できます' using errcode = 'P2082';
  end if;

  perform pg_advisory_xact_lock(hashtext('organization_admins:' || v_organization_id::text));

  select role into v_actor_role from profiles
  where id = p_actor_id and "organizationId" = v_organization_id;
  if not found or v_actor_role <> 'admin' then
    raise exception '管理者のみロールを変更できます' using errcode = 'P2082';
  end if;

  select role into v_previous_role from profiles
  where id = p_target_user_id and "organizationId" = v_organization_id
  for update;
  if not found or v_previous_role = 'shareholder' then
    raise exception '対象のメンバーが見つかりません: %', p_target_user_id using errcode = 'P2083';
  end if;

  if v_previous_role = p_role then
    return jsonb_build_object('changed', false, 'previousRole', v_previous_role, 'role', v_previous_role);
  end if;

  update profiles set role = p_role where id = p_target_user_id;

  insert into system_audit_logs ("organizationId", "userId", action, "entityName", "entityId", detail)
  values (
    v_organization_id,
    p_actor_id,
    'member.role.update',
    'profiles',
    p_target_user_id,
    jsonb_build_object('previousRole', v_previous_role, 'role', p_role)::text
  );

  return jsonb_build_object('changed', true, 'previousRole', v_previous_role, 'role', p_role);
end;
$$;

revoke execute on function change_member_role(uuid, uuid, text) from public, anon, authenticated;
grant execute on function change_member_role(uuid, uuid, text) to service_role;

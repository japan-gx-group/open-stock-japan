-- OpenStock Japan v0.1 初期スキーマ (2/3): RLS・権限・RPC
-- 方針:
--   * 全テーブルで RLS を有効にし、anon には何も付与しない。
--   * 組織・プロフィール・招待・事業年度・AI 設定・監査ログは、ログイン中のセッション（authenticated）から
--     自組織の分だけを読める（書けるのは下のポリシーにあるものだけ）。
--   * 株主・株式・新株予約権・会議・決算・文書などの業務テーブルは authenticated にポリシーも GRANT も与えない。
--     読み書きはすべてサーバ（Route Handler / Server Action）が、ロールと組織を確かめたうえで service_role で行う。
--     株主名簿は個人情報と持株を含み、株主ロール（shareholder）のアカウントも同じ認証基盤に乗るため、
--     PostgREST を直接叩いても業務テーブルへは到達できない形にしておく。

-- §1 RLS 補助関数（ポリシーからは (select fn()) の形で呼ぶ）

create function current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p."organizationId" from public.profiles p where p.id = auth.uid() limit 1
$$;

create function current_user_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select p.role from public.profiles p where p.id = auth.uid() limit 1
$$;

create function current_user_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
$$;

-- 社内のメンバー（管理者・メンバー・閲覧のみ）か。株主ロールは false。
create function current_user_is_internal()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'logger', 'viewer')
  )
$$;

revoke all on function current_user_organization_id() from public, anon, authenticated;
revoke all on function current_user_role() from public, anon, authenticated;
revoke all on function current_user_is_admin() from public, anon, authenticated;
revoke all on function current_user_is_internal() from public, anon, authenticated;

grant execute on function current_user_organization_id() to authenticated;
grant execute on function current_user_role() to authenticated;
grant execute on function current_user_is_admin() to authenticated;
grant execute on function current_user_is_internal() to authenticated;

-- §2 RLS の有効化（ポリシーを持たないテーブルは authenticated からも見えない）

alter table organizations enable row level security;
alter table profiles enable row level security;
alter table invites enable row level security;
alter table fiscal_years enable row level security;
alter table stakeholders enable row level security;
alter table officers enable row level security;
alter table share_classes enable row level security;
alter table funding_rounds enable row level security;
alter table share_transactions enable row level security;
alter table convertible_rounds enable row level security;
alter table convertible_investments enable row level security;
alter table option_plans enable row level security;
alter table option_grants enable row level security;
alter table option_events enable row level security;
alter table meetings enable row level security;
alter table meeting_agenda_items enable row level security;
alter table meeting_responses enable row level security;
alter table financial_reports enable row level security;
alter table documents enable row level security;
alter table document_shares enable row level security;
alter table share_links enable row level security;
alter table shareholder_updates enable row level security;
alter table ai_settings enable row level security;
alter table ai_credentials enable row level security;
alter table document_extractions enable row level security;
alter table system_audit_logs enable row level security;

-- §3 ポリシー

-- organizations: 自組織だけ。更新は管理者のみ。作成・削除はポリシーなし（初回セットアップの service_role のみ）。
create policy "organizations_select_own" on organizations
for select to authenticated
using (id = (select current_user_organization_id()));

create policy "organizations_update_own_admin" on organizations
for update to authenticated
using (id = (select current_user_organization_id()) and (select current_user_is_admin()))
with check (id = (select current_user_organization_id()) and (select current_user_is_admin()));

-- profiles: 社内メンバーは自組織の全員を、株主ロールは自分の行だけを読める
-- （株主どうしでメールアドレスが見えないようにする）。
create policy "profiles_select_own_or_internal" on profiles
for select to authenticated
using (
  id = (select auth.uid())
  or (
    "organizationId" = (select current_user_organization_id())
    and (select current_user_is_internal())
  )
);

create policy "profiles_update_own_profile" on profiles
for update to authenticated
using (id = (select auth.uid()))
with check (
  id = (select auth.uid())
  and "organizationId" = (select current_user_organization_id())
  and role = (select current_user_role())
);

create policy "fiscal_years_select_own_organization" on fiscal_years
for select to authenticated
using ("organizationId" = (select current_user_organization_id()) and (select current_user_is_internal()));

-- invites: 管理者だけ（token は招待リンクの秘密）。受諾は service_role のサーバ処理のみ。
create policy "invites_select_own_organization_admin" on invites
for select to authenticated
using ("organizationId" = (select current_user_organization_id()) and (select current_user_is_admin()));

create policy "invites_insert_own_organization_admin" on invites
for insert to authenticated
with check ("organizationId" = (select current_user_organization_id()) and (select current_user_is_admin()));

create policy "invites_delete_own_organization_admin" on invites
for delete to authenticated
using ("organizationId" = (select current_user_organization_id()) and (select current_user_is_admin()));

create policy "ai_settings_select_own_organization" on ai_settings
for select to authenticated
using ("organizationId" = (select current_user_organization_id()) and (select current_user_is_internal()));

-- system_audit_logs: 追記専用（UPDATE / DELETE は意図的に無し）。読めるのは社内メンバーだけ。
create policy "system_audit_logs_select_own_organization" on system_audit_logs
for select to authenticated
using ("organizationId" = (select current_user_organization_id()) and (select current_user_is_internal()));

create policy "system_audit_logs_insert_own_organization" on system_audit_logs
for insert to authenticated
with check ("organizationId" = (select current_user_organization_id()));

-- §4 GRANT / REVOKE（既定を拒否側に倒し、必要な分だけ与える）

revoke all on all tables in schema public from anon, authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from anon, authenticated;

grant select on organizations to authenticated;
grant update (
  name,
  "nameKana",
  "nameEn",
  "corporateNumber",
  "postalCode",
  address,
  phone,
  website,
  "representativeName",
  "representativeTitle",
  "establishedOn",
  "businessDescription",
  "fiscalYearStartMonth",
  "capitalAmount",
  "capitalReserveAmount",
  "authorizedShares",
  "isPublicCompany",
  "hasBoardOfDirectors",
  "hasAuditor",
  "auditorLimitedToAccounting",
  "hasTransferRestriction",
  "issuesShareCertificates",
  "publicNoticeMethod",
  "shareholderMeetingNoticeDays",
  "boardMeetingNoticeDays",
  "directorTermYears",
  "auditorTermYears",
  "allowsBoardWrittenResolution",
  "recordDateRule"
) on organizations to authenticated;

-- profiles: role / organizationId / email / stakeholderId は自己更新不可（列 GRANT から外す）。
grant select on profiles to authenticated;
grant update ("fullName", phone) on profiles to authenticated;

grant select on fiscal_years to authenticated;
grant select on ai_settings to authenticated;
grant select, insert on system_audit_logs to authenticated;

grant select on invites to authenticated;
grant insert ("organizationId", email, role) on invites to authenticated;
grant delete on invites to authenticated;

grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

alter default privileges in schema public grant select, insert, update, delete on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

-- §5 RPC

-- メンバーのロールを admin（管理者）/ logger（メンバー）に変える。株主ロールの行は対象にしない。
-- 操作する人が同じ組織の管理者であることを確かめ、監査ログを残す。service_role 限定。
create function change_member_role(
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
  if p_role is null or p_role not in ('admin', 'logger') then
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

  if (v_previous_role = 'admin') = (p_role = 'admin') then
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

-- 共有リンクのアクセス回数を 1 つ進める（読み取りと更新を 1 文で行う）。service_role 限定。
create function touch_share_link(p_token_hash text)
returns table ("documentId" uuid, "organizationId" uuid)
language sql
set search_path = public
as $$
  update share_links l
  set "accessCount" = l."accessCount" + 1, "lastAccessedAt" = now()
  where l."tokenHash" = p_token_hash and l."revokedAt" is null and l."expiresAt" > now()
  returning l."documentId", l."organizationId"
$$;

revoke execute on function touch_share_link(text) from public, anon, authenticated;
grant execute on function touch_share_link(text) to service_role;

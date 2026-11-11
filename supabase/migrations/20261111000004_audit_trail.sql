-- =====================================================================
-- 監査証跡（システム監査への対応）
--
-- 目的: 「だれが・いつ・どこから・何を・どう変えたか」を、アプリのコードに頼らず DB で残し、
--       あとから書き換え・削除できないようにする。説明は docs/system-audit.md。
--
--   §1 監査ログの列を足す（連番・ハッシュ・変更前後の値・接続元・結果）
--   §2 追記専用にする（更新・削除・全消去を DB のトリガーで拒否し、権限も外す）
--   §3 ハッシュの連鎖（1 行ごとに、直前の行のハッシュを含めてハッシュを取る。途中の改ざん・抜き取りを検出できる）
--   §4 全テーブルの行の変更を記録する（追加・更新・削除。変更前後の値つき。データの変更と同じトランザクション）
--   §5 ログイン・ログアウトなどの認証の記録
--   §6 検査（連鎖の検証）と、アカウントの棚卸しのための関数
--   §7 権限（読むのも書くのもサーバだけ）
--
-- 守ること:
--   - system_audit_logs に書けるのは、サーバ（service_role）とこのファイルのトリガーだけ。
--     ブラウザ（authenticated）からは読めないし、書けない。閲覧はサーバが権限を確かめてから返す。
--   - 連番・ハッシュ・記録時刻は DB が決める（呼び出し側が渡した値は使わない）。
--   - 操作した人は、(a) ブラウザから直接の更新は JWT の本人、(b) サーバ経由の更新はサーバが渡す
--     x-openstock-actor ヘッダ（src/lib/supabase/admin.ts）から取る。どちらも無いときは空（システムの処理）。
--   - DB の管理者（postgres など）は、トリガーを外せば何でもできる。そこは DB の運用（接続できる人の管理と
--     Postgres のログ）で守る範囲で、このファイルでは連鎖の検査で「変えられたこと」を見つけられるようにする。
-- =====================================================================

-- §1 列 -----------------------------------------------------------------------

-- 操作した人が決まらない記録（ログインの失敗、共有リンクからのアクセス、システムの処理）も残す。
alter table system_audit_logs alter column "userId" drop not null;

alter table system_audit_logs
  add column seq bigint,
  add column "prevHash" varchar(64),
  add column hash varchar(64),
  add column source varchar(10) not null default 'app',
  add column outcome varchar(10) not null default 'success',
  add column "actorEmail" varchar(255),
  add column "actorRole" varchar(50),
  add column "userAgent" text,
  add column "requestId" varchar(100),
  add column "oldValues" jsonb,
  add column "newValues" jsonb,
  -- app: アプリが残した操作の記録 / db: 行の変更（§4） / auth: 認証（§5）
  add constraint system_audit_logs_source_check check (source in ('app', 'db', 'auth')),
  add constraint system_audit_logs_outcome_check check (outcome in ('success', 'failure', 'denied'));

comment on column system_audit_logs.seq is '組織ごとの連番（1 から。DB が振る）。この列が空の行は、連鎖を入れる前の記録';
comment on column system_audit_logs.hash is 'この行のハッシュ（SHA-256）。直前の行のハッシュ（prevHash）を含めて計算する';

-- 監査ログは組織を消しても残す（組織の行への外部キーを外す）。
-- 外部キーがあると、組織の配下の行が消えるときの記録（§4）が書けず、初回登録の失敗の後始末もできない。
alter table system_audit_logs drop constraint "system_audit_logs_organizationId_fkey";

create unique index "system_audit_logs_organizationId_seq_key" on system_audit_logs ("organizationId", seq) where seq is not null;
create index "system_audit_logs_entity_idx" on system_audit_logs ("organizationId", "entityName", "entityId");
create index "system_audit_logs_user_idx" on system_audit_logs ("organizationId", "userId", "createdAt");
create index "system_audit_logs_action_idx" on system_audit_logs ("organizationId", action, "createdAt");

-- §2 追記専用 -------------------------------------------------------------------

-- DB の管理者が psql から行う保守（デモデータの入れ直しなど）のあいだだけ true。
-- アプリ（PostgREST 経由の service_role / authenticated）は session_user が authenticator なので、常に false。
create function audit_maintenance_enabled()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('openstock.audit_maintenance', true), '') = 'on'
    and session_user in ('postgres', 'supabase_admin');
$$;

create function reject_audit_log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') and public.audit_maintenance_enabled() then
    if tg_level = 'ROW' then
      return old;
    end if;
    return null;
  end if;
  raise exception '監査ログは追記専用です（% はできません）', tg_op using errcode = 'P3010';
end;
$$;

create trigger system_audit_logs_no_update before update on system_audit_logs
for each row execute function reject_audit_log_change();

create trigger system_audit_logs_no_delete before delete on system_audit_logs
for each row execute function reject_audit_log_change();

create trigger system_audit_logs_no_truncate before truncate on system_audit_logs
for each statement execute function reject_audit_log_change();

-- リクエストの情報（操作した人・接続元）。PostgREST 経由のときだけ、JWT とヘッダから取れる。
--   ブラウザからの直接の操作（authenticated）: 本人は JWT で決まる。ヘッダでの申告は使わない
--   サーバ経由の操作（service_role）: サーバが、権限を確かめた本人と接続元をヘッダで渡す（src/lib/supabase/admin.ts）
--   それ以外（認証サービスや psql からの操作）: 何も取れない
create function audit_request_info()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claims jsonb;
  v_headers jsonb;
  v_role text;
  v_actor uuid;
begin
  begin
    v_claims := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    return '{}'::jsonb;
  end;
  v_role := v_claims ->> 'role';

  if v_role = 'authenticated' then
    return jsonb_build_object(
      'actor', auth.uid(),
      'ip', nullif(trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
      'agent', v_headers ->> 'user-agent'
    );
  end if;

  if v_role = 'service_role' then
    begin
      v_actor := nullif(v_headers ->> 'x-openstock-actor', '')::uuid;
    exception when others then
      v_actor := null;
    end;
    return jsonb_build_object(
      'actor', v_actor,
      'ip', nullif(v_headers ->> 'x-openstock-ip', ''),
      'agent', nullif(v_headers ->> 'x-openstock-user-agent', ''),
      'request', nullif(v_headers ->> 'x-openstock-request-id', '')
    );
  end if;

  return '{}'::jsonb;
end;
$$;

-- §3 ハッシュの連鎖 ---------------------------------------------------------------

-- ハッシュの対象にする文字列。行のすべての内容を、決まった順に区切り文字（U+001F）でつなぐ。
-- 検査（verify_audit_log_chain）も同じ関数を使うので、列を足したらここにも足すこと。
create function audit_log_canonical(r public.system_audit_logs)
returns text
language sql
stable
set search_path = ''
as $$
  select concat_ws(
    E'\x1f',
    r.seq::text,
    r.id::text,
    r."organizationId"::text,
    coalesce(r."userId"::text, ''),
    r.action,
    r."entityName",
    coalesce(r."entityId"::text, ''),
    coalesce(r.detail, ''),
    coalesce(r."oldValues"::text, ''),
    coalesce(r."newValues"::text, ''),
    r.source,
    r.outcome,
    coalesce(r."actorEmail", ''),
    coalesce(r."actorRole", ''),
    coalesce(r."ipAddress", ''),
    coalesce(r."userAgent", ''),
    coalesce(r."requestId", ''),
    to_char(r."createdAt" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );
$$;

-- 追加のたびに、連番・記録時刻・接続元・操作した人のメールアドレスとロール（その時点の値）・ハッシュを DB が決める。
-- 組織ごとにアドバイザリロックを取り、同時の追加でも連番と連鎖が 1 本になるようにする。
create function seal_audit_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last record;
  v_profile record;
  v_info jsonb;
begin
  -- 接続元（IP アドレス・ブラウザ・リクエストの番号）は、呼び出し側が渡していなければリクエストから補う
  if new.source <> 'auth' then
    v_info := public.audit_request_info();
    new."ipAddress" := coalesce(new."ipAddress", left(v_info ->> 'ip', 45));
    new."userAgent" := coalesce(new."userAgent", left(v_info ->> 'agent', 500));
    new."requestId" := coalesce(new."requestId", left(v_info ->> 'request', 100));
  end if;

  perform pg_advisory_xact_lock(hashtextextended('system_audit_logs:' || new."organizationId"::text, 0));

  select seq, hash into v_last
  from public.system_audit_logs
  where "organizationId" = new."organizationId" and seq is not null
  order by seq desc
  limit 1;

  new.id := coalesce(new.id, gen_random_uuid());
  new.seq := coalesce(v_last.seq, 0) + 1;
  new."prevHash" := coalesce(v_last.hash, '');
  new."createdAt" := clock_timestamp();

  if new."userId" is not null then
    select email, role into v_profile from public.profiles where id = new."userId";
    if found then
      new."actorEmail" := v_profile.email;
      new."actorRole" := v_profile.role;
    end if;
  end if;

  new.hash := encode(sha256(convert_to(new."prevHash" || E'\n' || public.audit_log_canonical(new), 'UTF8')), 'hex');
  return new;
end;
$$;

-- 名前順で set_system_audit_logs_user_id（操作者の上書き）より後に動く。
create trigger system_audit_logs_seal before insert on system_audit_logs
for each row execute function seal_audit_log();

-- §4 行の変更の記録 ---------------------------------------------------------------

-- 記録に残さない値を伏せる。秘密の値（招待・共有リンクのトークン、API キーの暗号文）は「（秘匿）」にし、
-- 長い値（AI の読み取り結果など）は文字数とハッシュだけにする。
create function audit_mask_row(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(
      e.key,
      case
        when e.key in ('token', 'tokenHash', 'ciphertext', 'iv', 'authTag') and e.value <> 'null'::jsonb
          then to_jsonb('（秘匿）'::text)
        when length(e.value::text) > 4000
          then jsonb_build_object(
            'omitted', true,
            'length', length(e.value::text),
            'sha256', encode(sha256(convert_to(e.value::text, 'UTF8')), 'hex')
          )
        else e.value
      end
    ),
    '{}'::jsonb
  )
  from jsonb_each(p_row) e;
$$;

-- 行の追加・更新・削除を 1 行ずつ監査ログに残す（データの変更と同じトランザクション）。
--   追加: newValues に行の全体 / 削除: oldValues に行の全体 / 更新: 変わった列だけを oldValues・newValues に
--   （updatedAt だけが変わった更新は記録しない）
create function audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_old_out jsonb;
  v_new_out jsonb;
  v_org uuid;
  v_entity uuid;
  v_actor uuid;
begin
  -- DB の管理者による保守（デモデータの入れ直しなど）は記録しない
  if public.audit_maintenance_enabled() then
    return null;
  end if;

  if tg_op <> 'INSERT' then
    v_old := public.audit_mask_row(to_jsonb(old));
  end if;
  if tg_op <> 'DELETE' then
    v_new := public.audit_mask_row(to_jsonb(new));
  end if;

  if tg_op = 'UPDATE' then
    select jsonb_object_agg(o.key, o.value) into v_old_out
    from jsonb_each(v_old) o
    where o.key <> 'updatedAt' and (v_new -> o.key) is distinct from o.value;

    select jsonb_object_agg(n.key, n.value) into v_new_out
    from jsonb_each(v_new) n
    where n.key <> 'updatedAt' and (v_old -> n.key) is distinct from n.value;

    if v_old_out is null and v_new_out is null then
      return null;
    end if;
  else
    v_old_out := v_old;
    v_new_out := v_new;
  end if;

  if tg_table_name = 'organizations' then
    v_org := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  else
    v_org := coalesce(v_new ->> 'organizationId', v_old ->> 'organizationId')::uuid;
  end if;
  if v_org is null then
    return null;
  end if;

  -- 対象の行の id（id 列が uuid のテーブルだけ。招待は主キーが秘密のトークンなので入れない）
  begin
    v_entity := coalesce(v_new ->> 'id', v_old ->> 'id')::uuid;
  exception when others then
    v_entity := null;
  end;

  -- 操作した人。接続元は seal_audit_log が補う
  begin
    v_actor := nullif(public.audit_request_info() ->> 'actor', '')::uuid;
  exception when others then
    v_actor := null;
  end;

  insert into public.system_audit_logs (
    "organizationId", "userId", action, "entityName", "entityId", "oldValues", "newValues", source
  )
  values (
    v_org, v_actor, tg_table_name || '.' || lower(tg_op), tg_table_name, v_entity, v_old_out, v_new_out, 'db'
  );
  return null;
end;
$$;

-- 業務・設定のすべてのテーブルに付ける。テーブルを足したら、同じ形のトリガーをここと同じ名前の付け方で足すこと
-- （付け忘れは scripts/db/__tests__/auditTrailMigration.test.ts が見つける）。
create trigger audit_organizations after insert or update or delete on organizations for each row execute function audit_row_change();
create trigger audit_profiles after insert or update or delete on profiles for each row execute function audit_row_change();
create trigger audit_invites after insert or update or delete on invites for each row execute function audit_row_change();
create trigger audit_fiscal_years after insert or update or delete on fiscal_years for each row execute function audit_row_change();
create trigger audit_stakeholders after insert or update or delete on stakeholders for each row execute function audit_row_change();
create trigger audit_officers after insert or update or delete on officers for each row execute function audit_row_change();
create trigger audit_share_classes after insert or update or delete on share_classes for each row execute function audit_row_change();
create trigger audit_funding_rounds after insert or update or delete on funding_rounds for each row execute function audit_row_change();
create trigger audit_share_transactions after insert or update or delete on share_transactions for each row execute function audit_row_change();
create trigger audit_convertible_rounds after insert or update or delete on convertible_rounds for each row execute function audit_row_change();
create trigger audit_convertible_investments after insert or update or delete on convertible_investments for each row execute function audit_row_change();
create trigger audit_option_plans after insert or update or delete on option_plans for each row execute function audit_row_change();
create trigger audit_option_grants after insert or update or delete on option_grants for each row execute function audit_row_change();
create trigger audit_option_events after insert or update or delete on option_events for each row execute function audit_row_change();
create trigger audit_meetings after insert or update or delete on meetings for each row execute function audit_row_change();
create trigger audit_meeting_agenda_items after insert or update or delete on meeting_agenda_items for each row execute function audit_row_change();
create trigger audit_meeting_responses after insert or update or delete on meeting_responses for each row execute function audit_row_change();
create trigger audit_financial_reports after insert or update or delete on financial_reports for each row execute function audit_row_change();
create trigger audit_documents after insert or update or delete on documents for each row execute function audit_row_change();
create trigger audit_document_shares after insert or update or delete on document_shares for each row execute function audit_row_change();
create trigger audit_share_links after insert or update or delete on share_links for each row execute function audit_row_change();
create trigger audit_shareholder_updates after insert or update or delete on shareholder_updates for each row execute function audit_row_change();
create trigger audit_ai_settings after insert or update or delete on ai_settings for each row execute function audit_row_change();
create trigger audit_ai_credentials after insert or update or delete on ai_credentials for each row execute function audit_row_change();
create trigger audit_document_extractions after insert or update or delete on document_extractions for each row execute function audit_row_change();
create trigger audit_compliance_task_states after insert or update or delete on compliance_task_states for each row execute function audit_row_change();

-- §5 認証の記録 -------------------------------------------------------------------

-- ログイン（セッションの開始）。接続元の IP アドレスとブラウザも残す。
-- 記録に失敗してもログインは止めない（例外は握り、警告だけ出す）。
create function audit_auth_session()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  select "organizationId" into v_org from public.profiles where id = new.user_id;
  if v_org is null then
    return null;
  end if;

  insert into public.system_audit_logs (
    "organizationId", "userId", action, "entityName", "entityId", detail, "ipAddress", "userAgent", source
  )
  values (
    v_org, new.user_id, 'auth.login', 'auth.sessions', new.id,
    jsonb_build_object('aal', new.aal::text)::text, host(new.ip), left(new.user_agent, 500), 'auth'
  );
  return null;
exception when others then
  raise warning '監査ログ（ログイン）の記録に失敗しました: %', sqlerrm;
  return null;
end;
$$;

-- 認証サービス（Supabase Auth）が自分で残す記録のうち、ログイン以外（ログアウト、パスワードの再設定の要求、
-- ユーザー情報の変更、二要素認証の登録・解除など）を写す。ログインは上の関数が、接続元つきで残す。
create function audit_auth_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
  v_action text;
  v_actor uuid;
  v_org uuid;
begin
  v_payload := new.payload::jsonb;
  v_action := v_payload ->> 'action';
  if v_action is null or v_action in ('login', 'token_refreshed', 'token_revoked') then
    return null;
  end if;

  v_actor := nullif(v_payload ->> 'actor_id', '')::uuid;
  select "organizationId" into v_org from public.profiles where id = v_actor;
  if v_org is null then
    return null;
  end if;

  insert into public.system_audit_logs (
    "organizationId", "userId", action, "entityName", "entityId", detail, "ipAddress", source
  )
  values (
    v_org, v_actor, 'auth.' || left(v_action, 80), 'auth.users', v_actor,
    (v_payload - 'actor_id' - 'actor_name' - 'actor_username')::text, nullif(left(new.ip_address, 45), ''), 'auth'
  );
  return null;
exception when others then
  raise warning '監査ログ（認証）の記録に失敗しました: %', sqlerrm;
  return null;
end;
$$;

-- auth スキーマのテーブルにトリガーを付ける。権限が無い環境ではここだけ飛ばす
-- （そのときログインの記録は残らない。docs/system-audit.md の「導入時の確認」で確かめる）。
do $$
begin
  execute 'create trigger openstock_audit_auth_session after insert on auth.sessions for each row execute function public.audit_auth_session()';
  execute 'create trigger openstock_audit_auth_event after insert on auth.audit_log_entries for each row execute function public.audit_auth_event()';
exception
  when insufficient_privilege or undefined_table then
    raise warning 'auth スキーマにトリガーを作れませんでした。ログイン・ログアウトの記録は残りません: %', sqlerrm;
end;
$$;

-- §6 検査と棚卸し -----------------------------------------------------------------

-- 連鎖を先頭から計算し直して、記録と合うかを確かめる。合わない最初の連番と理由を返す。
--   gap                … 連番が飛んでいる（行が抜かれた）
--   prev_hash_mismatch … 直前の行のハッシュと合わない（行が差し替えられた）
--   hash_mismatch      … 行の内容とハッシュが合わない（行が書き換えられた）
-- 末尾の行を消された場合はここでは分からないので、lastSeq / lastHash を定期的に外へ控えておく。
create function verify_audit_log_chain(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.system_audit_logs;
  v_prev_seq bigint := 0;
  v_prev_hash text := '';
  v_count bigint := 0;
  v_legacy bigint;
  v_expected text;
begin
  for r in
    select * from public.system_audit_logs
    where "organizationId" = p_organization_id and seq is not null
    order by seq
  loop
    v_count := v_count + 1;
    if r.seq <> v_prev_seq + 1 then
      return jsonb_build_object('ok', false, 'reason', 'gap', 'seq', r.seq, 'expectedSeq', v_prev_seq + 1, 'count', v_count);
    end if;
    if r."prevHash" is distinct from v_prev_hash then
      return jsonb_build_object('ok', false, 'reason', 'prev_hash_mismatch', 'seq', r.seq, 'count', v_count);
    end if;
    v_expected := encode(sha256(convert_to(r."prevHash" || E'\n' || public.audit_log_canonical(r), 'UTF8')), 'hex');
    if r.hash is distinct from v_expected then
      return jsonb_build_object('ok', false, 'reason', 'hash_mismatch', 'seq', r.seq, 'count', v_count);
    end if;
    v_prev_seq := r.seq;
    v_prev_hash := r.hash;
  end loop;

  select count(*) into v_legacy from public.system_audit_logs
  where "organizationId" = p_organization_id and seq is null;

  return jsonb_build_object(
    'ok', true,
    'count', v_count,
    'lastSeq', v_prev_seq,
    'lastHash', v_prev_hash,
    'legacyCount', v_legacy,
    'checkedAt', now()
  );
end;
$$;

-- アカウントの棚卸し（アクセス権の定期的な見直し）のための一覧。最後のログインと二要素認証の登録数は auth スキーマから読む。
create function list_account_access(p_organization_id uuid)
returns table (
  id uuid,
  email text,
  "fullName" text,
  role text,
  "stakeholderId" uuid,
  "createdAt" timestamptz,
  "lastSignInAt" timestamptz,
  "mfaFactorCount" integer,
  "bannedUntil" timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.email::text,
    p."fullName"::text,
    p.role::text,
    p."stakeholderId",
    p."createdAt",
    u.last_sign_in_at,
    (select count(*)::integer from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'),
    u.banned_until
  from public.profiles p
  left join auth.users u on u.id = p.id
  where p."organizationId" = p_organization_id
  order by p."createdAt", p.id;
$$;

-- §7 権限 -----------------------------------------------------------------------

-- ブラウザ（authenticated）からは読ませない・書かせない。閲覧はサーバが管理者（または監査人）であることを確かめてから返す。
drop policy "system_audit_logs_select_own_organization" on system_audit_logs;
drop policy "system_audit_logs_insert_own_organization" on system_audit_logs;
revoke all on system_audit_logs from anon, authenticated;

-- サーバ（service_role）も、追加と読み取りだけ。
revoke update, delete, truncate, references, trigger on system_audit_logs from service_role;

revoke execute on function audit_maintenance_enabled() from public, anon, authenticated;
revoke execute on function reject_audit_log_change() from public, anon, authenticated;
revoke execute on function audit_request_info() from public, anon, authenticated;
revoke execute on function audit_log_canonical(public.system_audit_logs) from public, anon, authenticated;
revoke execute on function seal_audit_log() from public, anon, authenticated;
revoke execute on function audit_mask_row(jsonb) from public, anon, authenticated;
revoke execute on function audit_row_change() from public, anon, authenticated;
revoke execute on function audit_auth_session() from public, anon, authenticated;
revoke execute on function audit_auth_event() from public, anon, authenticated;
revoke execute on function verify_audit_log_chain(uuid) from public, anon, authenticated;
revoke execute on function list_account_access(uuid) from public, anon, authenticated;

grant execute on function verify_audit_log_chain(uuid) to service_role;
grant execute on function list_account_access(uuid) to service_role;

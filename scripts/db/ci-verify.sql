-- CI の Database Migrations が、マイグレーションとデモシードを流したあとに実行する確認。
-- 手元でも実行できる（ローカルの Supabase に、デモシードが入っていること。データは変わらない）:
--   docker exec -i supabase_db_open-stock-japan psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/db/ci-verify.sql
--
-- 確かめること:
--   1. デモシードの各節のテーブルに、行が入っている
--   2. public のテーブルは、すべて RLS が有効になっている
--   3. ふつうの変更が、監査ログに連鎖つきで残り、改ざんの検査を通る
--
-- 3 のために行を 1 つ書き換えるので、全体を 1 つのトランザクションにして、最後に必ず取り消す（rollback）。
-- 監査ログの番号（seq）は「直前の行 + 1」で決まり、シーケンスを使わないので、取り消しても欠番はできない。
begin;

do $$
declare
  v_table text;
  v_count bigint;
  v_org record;
  v_before jsonb;
  v_after jsonb;
  v_orgs integer := 0;
begin
  -- 1. デモシードが入っているか
  foreach v_table in array array[
    'organizations', 'profiles', 'fiscal_years', 'stakeholders', 'share_classes', 'funding_rounds',
    'share_transactions', 'convertible_rounds', 'convertible_investments', 'option_plans', 'option_grants',
    'meetings', 'meeting_agenda_items', 'financial_reports', 'shareholder_updates', 'document_templates'
  ] loop
    execute format('select count(*) from public.%I', v_table) into v_count;
    if v_count = 0 then
      raise exception 'デモシードのあと、% に行がありません', v_table;
    end if;
  end loop;

  -- 2. public のテーブルは、すべて RLS が有効
  for v_table in
    select c.relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    raise exception 'RLS が有効になっていないテーブルがあります: %', v_table;
  end loop;

  -- 3. 監査ログ。デモシードの投入は DB の保守の扱いで、監査ログには残らない（シードの直後は 0 行で正しい）。
  --    ここでは、保守の扱いではない変更を 1 つ行い、1 行増えて、連鎖の検査を通ることを確かめる。
  for v_org in
    select o.id, o.name from public.organizations o
    where exists (select 1 from public.document_templates t where t."organizationId" = o.id)
  loop
    v_orgs := v_orgs + 1;
    v_before := public.verify_audit_log_chain(v_org.id);
    if not coalesce((v_before ->> 'ok')::boolean, false) then
      raise exception '監査ログの連鎖の検査に失敗しました（組織 %）: %', v_org.name, v_before;
    end if;

    update public.document_templates set title = title || '（確認）'
    where id = (select id from public.document_templates where "organizationId" = v_org.id order by id limit 1);

    v_after := public.verify_audit_log_chain(v_org.id);
    if not coalesce((v_after ->> 'ok')::boolean, false) then
      raise exception '変更のあと、監査ログの連鎖の検査に失敗しました（組織 %）: %', v_org.name, v_after;
    end if;
    if (v_after ->> 'count')::bigint <> (v_before ->> 'count')::bigint + 1 then
      raise exception '変更が監査ログに残っていません（組織 %）。変更の前 % 行、あと % 行',
        v_org.name, v_before ->> 'count', v_after ->> 'count';
    end if;
    raise notice '監査ログ: 組織「%」 変更の前 % 行 → あと % 行、連鎖 OK', v_org.name, v_before ->> 'count', v_after ->> 'count';
  end loop;

  if v_orgs = 0 then
    raise exception 'テンプレートを持つ組織がありません';
  end if;
end;
$$;

-- 確認のために書き換えた行と、それで増えた監査ログの行を取り消す
rollback;

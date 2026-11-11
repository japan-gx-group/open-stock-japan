-- CI の Database Migrations が、マイグレーションとデモシードを流したあとに実行する確認。
-- 手元でも実行できる（ローカルの Supabase に、デモシードが入っていること）:
--   docker exec -i supabase_db_open-stock-japan psql -U postgres -d postgres -v ON_ERROR_STOP=1 < scripts/db/ci-verify.sql
--
-- 確かめること:
--   1. デモシードの各節のテーブルに、行が入っている
--   2. すべての業務テーブルで RLS が有効になっている
--   3. シードの投入でできた監査ログの連鎖が、組織ごとに検査を通る（トリガーの付け忘れ・順番の崩れを見つける）
do $$
declare
  v_table text;
  v_count bigint;
  v_org record;
  v_result jsonb;
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

  -- 3. 監査ログの連鎖
  for v_org in select id, name from public.organizations loop
    v_orgs := v_orgs + 1;
    v_result := public.verify_audit_log_chain(v_org.id);
    if not coalesce((v_result->>'ok')::boolean, false) then
      raise exception '監査ログの連鎖の検査に失敗しました（組織 %）: %', v_org.name, v_result;
    end if;
    if coalesce((v_result->>'count')::bigint, 0) = 0 then
      raise exception '監査ログに行がありません（組織 %）。シードの変更が、トリガーで記録されていません', v_org.name;
    end if;
    raise notice '監査ログの連鎖: 組織「%」 % 行 OK', v_org.name, v_result->>'count';
  end loop;

  if v_orgs = 0 then
    raise exception '組織がありません';
  end if;
end;
$$;

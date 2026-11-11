-- =====================================================================
-- 認証のポリシー（二要素認証）
--
-- 目的: 二要素認証（TOTP。Supabase Auth の MFA）を「画面の案内」ではなく、サーバと DB で強制する。
--
--   §1 組織の設定: 社内のアカウント（管理者・メンバー・閲覧のみ・監査人）に二要素認証を必須にするか
--   §2 current_session_mfa_ok(): いまのセッションが、二要素認証の条件を満たしているか
--   §3 ブラウザ（authenticated）から直接読めるテーブルに、§2 を条件にした制限つきポリシーを足す
--
-- 守ること:
--   - 「条件を満たしている」とは次のどちらか。判定の正本は src/features/auth/utils/mfaState.ts の decideMfaState で、
--     ここは同じ内容を DB 側で確かめる（サーバを通らず PostgREST を直接叩いても、同じ結果になるようにする）。
--       (a) 確認済みの要素を持っている人は、セッションが aal2（パスワードに加えてコードを確認済み）であること
--       (b) 確認済みの要素を持っていない人は、「組織が必須にしていて、かつ社内のロール」でないこと
--   - 必須にするかどうかの列（requireMfaForInternal）は、authenticated の列 GRANT に足さない。
--     変更は、サーバが管理者であることを確かめてから service_role で行う
--     （src/features/settings/services/mfaAdmin.ts）。変更は organizations の行のトリガーが監査ログに残す。
--   - 業務テーブル（株主・株式・会議・文書など）は、もともと authenticated に GRANT もポリシーも無い。
--     そちらはサーバの getCurrentProfile()（src/lib/currentProfile.ts）が同じ判定をして 401 を返す。
-- =====================================================================

-- §1 組織の設定 -----------------------------------------------------------------

alter table organizations
  add column "requireMfaForInternal" boolean not null default false;

comment on column organizations."requireMfaForInternal" is
  '社内のアカウント（管理者・メンバー・閲覧のみ・監査人）に二要素認証を必須にする。株主ロールは対象外（本人が任意で設定できる）';

-- §2 セッションの判定 -------------------------------------------------------------

-- いまのセッション（JWT）が、二要素認証の条件を満たしているか。ポリシーからは (select fn()) の形で呼ぶ。
--   確認済みの要素がある      … JWT の aal が aal2 のときだけ true
--   確認済みの要素が無い      … 組織が必須にしていて社内のロールなら false（先に登録が要る）。それ以外は true
-- 要素の一覧は auth.mfa_factors を直接読む（JWT の内容やブラウザの申告は使わない）。
-- 社内のロールかどうかは current_user_is_internal() に任せる（ロールが増えても、ここは変えなくてよい）。
create function current_session_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (
      select 1 from auth.mfa_factors f
      where f.user_id = auth.uid() and f.status = 'verified'
    ) then coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
    else not (
      public.current_user_is_internal()
      and exists (
        select 1 from public.organizations o
        where o.id = public.current_user_organization_id() and o."requireMfaForInternal"
      )
    )
  end
$$;

revoke all on function current_session_mfa_ok() from public, anon, authenticated;
grant execute on function current_session_mfa_ok() to authenticated;

-- §3 制限つきポリシー -------------------------------------------------------------

-- authenticated に GRANT のある 5 つのテーブル（組織・プロフィール・招待・事業年度・AI 設定）すべてに付ける。
-- restrictive（制限）なので、いまある許可のポリシーに「かつ」で掛かる。読み取りも書き込みも対象。
-- パスワードだけを知っている人が、コードの確認の前に PostgREST を直接叩いても、
-- メンバーの一覧を読む・企業情報を書き換える・招待を作る、といったことはできない。
-- authenticated に GRANT のあるテーブルを足したら、同じ形のポリシーをここと同じ名前の付け方で足すこと
-- （付け忘れは scripts/db/__tests__/authPolicyMigration.test.ts が見つける）。
create policy "organizations_require_mfa" on organizations
as restrictive for all to authenticated
using ((select current_session_mfa_ok()))
with check ((select current_session_mfa_ok()));

create policy "profiles_require_mfa" on profiles
as restrictive for all to authenticated
using ((select current_session_mfa_ok()))
with check ((select current_session_mfa_ok()));

create policy "invites_require_mfa" on invites
as restrictive for all to authenticated
using ((select current_session_mfa_ok()))
with check ((select current_session_mfa_ok()));

create policy "fiscal_years_require_mfa" on fiscal_years
as restrictive for all to authenticated
using ((select current_session_mfa_ok()))
with check ((select current_session_mfa_ok()));

create policy "ai_settings_require_mfa" on ai_settings
as restrictive for all to authenticated
using ((select current_session_mfa_ok()))
with check ((select current_session_mfa_ok()));

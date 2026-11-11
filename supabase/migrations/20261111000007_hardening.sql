-- =====================================================================
-- 公開前のセキュリティの点検で見つかった、DB 側の細かい締め直し
--
--   §1 組織の情報（organizations）を、株主ロールのアカウントがブラウザから直接読めないようにする
--   §2 最初のマイグレーションのトリガー関数から、ブラウザのロールの実行権限を外す
--   §3 監査ログに、API キーの末尾 4 文字と指紋を残さない
--
-- どれも、アプリの画面の動きは変えない。
-- =====================================================================

-- §1 organizations: 読めるのは社内の人（管理者・メンバー・閲覧のみ・監査人）だけにする。
-- これまでは「自分の組織の行」をだれでも読めたので、株主ロールのアカウントが PostgREST を直接呼ぶと、
-- 資本金・機関設計・二要素認証の設定など、株主ポータルでは見せていない列まで読めた。
-- 株主ポータルに出す会社名は、サーバが service_role で読んで渡している（src/features/portal/services/portal.server.ts）。
drop policy "organizations_select_own" on organizations;

create policy "organizations_select_own" on organizations
for select to authenticated
using (id = (select current_user_organization_id()) and (select current_user_is_internal()));

-- §2 トリガー関数は、トリガーからしか呼ばれない。PostgREST からは呼べない（引数の形が合わない）が、
-- ほかの関数と同じく、ブラウザのロール（anon・authenticated）と PUBLIC の実行権限を外してそろえる。
revoke execute on function set_updated_at() from public, anon, authenticated;
revoke execute on function set_audit_user_id() from public, anon, authenticated;
revoke execute on function set_invite_inviter() from public, anon, authenticated;
revoke execute on function check_option_event_units() from public, anon, authenticated;
revoke execute on function ensure_organization_keeps_admin() from public, anon, authenticated;

-- §3 記録に残さない値に、登録した API キーの末尾 4 文字（keyLast4）と指紋（keyId）を足す。
-- 鍵そのものではないが、追記専用で消せない記録に、鍵を絞り込む手がかりを残さない。
-- （ほかの内容は 20261111000004_audit_trail.sql の audit_mask_row と同じ。）
create or replace function audit_mask_row(p_row jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    jsonb_object_agg(
      e.key,
      case
        when e.key in ('token', 'tokenHash', 'ciphertext', 'iv', 'authTag', 'keyLast4', 'keyId') and e.value <> 'null'::jsonb
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

revoke execute on function audit_mask_row(jsonb) from public, anon, authenticated;

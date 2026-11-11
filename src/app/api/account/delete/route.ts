// アカウント削除（退会）の Route Handler。
// auth ユーザーの削除は service_role（admin client）が必要なためサーバで行う。
//
// セキュリティ設計:
//   - 削除対象は「セッションのユーザー自身」に固定する。リクエストボディの id 等は一切信用しない。
//   - service_role は RLS をバイパスするため、必ず先にセッションでログイン本人を確定させる。
//   - 社内メンバーが組織で最後の1人（社内メンバー不在になる削除）のときは拒否する（isLastMember ガード）。
//     人数は社内のロール（admin / logger / viewer）だけで数える。株主ロールのアカウントは数に入れず、
//     株主本人の退会はこのガードの対象にしない（株主が残っていても、社内に誰もいなければ組織を管理できない）。
//   - 組織で最後の管理者（管理者が 0 人になる削除）も拒否する（isLastAdmin ガード）。
//   - 破壊的操作のため、Origin ヘッダがサイト自身であることを確認する（CSRF緩和。src/lib/security/origin.ts）。
//   - 二要素認証が済んでいないセッション（パスワードだけを知っている人）からは削除させない
//     （getSessionState の mfa が 'ok' のときだけ進める）。

import { NextResponse, type NextRequest } from 'next/server';
import { getSessionState } from '@/lib/sessionState';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSameOriginRequest } from '@/lib/security/origin';
import { recordAuditEvent } from '@/lib/audit/events';
import { isLastAdmin, isLastMember } from '@/features/settings/services/accountGuards';
import { INTERNAL_ROLES, isAdmin, isInternal, isMemberRole } from '@/types/role';

// service_role を使うため Node ランタイムで実行する（Edge では実行しない）。
export const runtime = 'nodejs';

export const POST = async (request: NextRequest) => {
  if (!isSameOriginRequest(request)) {
    return NextResponse.json({ error: '不正なリクエスト元です' }, { status: 403 });
  }

  // 1) セッションからログイン本人を確定する（ここが削除対象の唯一の根拠）。
  //    二要素認証がまだのセッションは、ログインしていない扱いにする。
  const session = await getSessionState();
  const user = session.mfa === 'ok' ? session.user : null;
  if (!user) {
    return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 });
  }

  const admin = createAdminClient();

  // 2) 本人のプロフィール（組織・権限）を取得する。
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id, organizationId, role')
    .eq('id', user.id)
    .single();
  if (profileError || !profile) {
    return NextResponse.json({ error: 'プロフィールが見つかりません' }, { status: 404 });
  }

  // 3) 安全ガード: 組織で最後の1人なら削除を拒否する。
  // 既知の限界（TOCTOU）: このカウントと下の削除はトランザクション化できないため
  // （supabase-js は複数文のトランザクションを張れない）、2人がミリ秒差で同時に退会すると
  // 両方が count>1 を通過し、メンバー不在の組織が残り得る。
  // 自社ホスト・単一テナント運用では実質発生しないため、DB関数化まではしない。
  //
  // 数えるのは社内のメンバーだけ。株主ロールの本人の退会は対象にしない。
  // role が想定外の値なら、社内メンバーとして扱う（安全側 = ガードをかける）。
  const callerIsInternal = !isMemberRole(profile.role) || isInternal(profile.role);
  if (callerIsInternal) {
    const { count, error: countError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organizationId', profile.organizationId)
      .in('role', [...INTERNAL_ROLES]);
    if (countError) {
      return NextResponse.json(
        { error: 'アカウント削除の事前確認に失敗しました' },
        { status: 500 },
      );
    }
    if (isLastMember(count ?? 0)) {
      return NextResponse.json(
        {
          error:
            '組織で最後のメンバーのため削除できません。先に別のメンバーを招待してください',
        },
        { status: 409 },
      );
    }
  }

  // 3b) 安全ガード: 組織で最後の管理者なら削除を拒否する。同時の操作は DB のトリガー
  //     （ensure_organization_keeps_admin）が組織ごとのロックで止めるので、上のような TOCTOU は残らない。
  //     role が想定外の値なら、管理者ではないものとして扱う。
  if (isMemberRole(profile.role) && isAdmin(profile.role)) {
    const { count: adminCount, error: adminCountError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('organizationId', profile.organizationId)
      .eq('role', 'admin');
    if (adminCountError) {
      return NextResponse.json(
        { error: 'アカウント削除の事前確認に失敗しました' },
        { status: 500 },
      );
    }
    if (isLastAdmin(profile.role, adminCount ?? 0)) {
      return NextResponse.json(
        {
          error:
            '組織で最後の管理者のため削除できません。先に別のメンバーを管理者にしてください',
        },
        { status: 409 },
      );
    }
  }

  // 4) auth ユーザーを削除する。
  //    profiles.id は auth.users を on delete cascade で参照するため、profiles 行も同時に消える。
  const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
  if (deleteError) {
    return NextResponse.json({ error: 'アカウントの削除に失敗しました' }, { status: 500 });
  }
  // 退会を本人の操作として残す。profiles の行はもう無いので、メールアドレスとロールはここで渡す
  await recordAuditEvent(
    {
      organizationId: profile.organizationId as string,
      userId: user.id,
      email: user.email ?? undefined,
      role: typeof profile.role === 'string' ? profile.role : undefined,
    },
    { action: 'account.delete', entityName: 'profiles', entityId: user.id },
    admin,
  );

  return NextResponse.json({ ok: true });
};

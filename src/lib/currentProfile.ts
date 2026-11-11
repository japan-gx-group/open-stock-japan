// ログイン中ユーザーの profiles 行（ロール・所属組織・紐づく権利者）をサーバ側で取得する共通ヘルパー。
// Server Component / Server Action / Route Handler から使う（セッション Cookie 前提）。
// 権限チェック（admin か・書き込みできるか）の判定材料はクライアントから受け取らず、
// 必ずこの関数でサーバ側から取得すること（クライアント値は改ざんできるため）。
//
// 二要素認証（src/lib/sessionState.ts）: 次のどちらかのときは、ログインしていても null を返す
// （= この関数に頼るすべての API・Server Action が 401 になり、画面は /mfa・/mfa/setup へ送られる）。
//   (a) 確認済みの要素（TOTP）を登録しているのに、セッションがまだパスワードだけ（aal2 でない）
//   (b) 組織が社内のアカウントに二要素認証を必須にしているのに、社内のロールの本人が要素を登録していない
// 「ログインはしているが、まだ」の人を扱う画面（/mfa など）だけは、getSessionState() を直接使う。
//
// ⚠️ サーバ専用: cookies() を使うため Client Component から import しないこと。

import { cache } from 'react';
import { getSessionState } from '@/lib/sessionState';
import type { MemberRole } from '@/types/role';

export interface CurrentProfile {
  id: string;
  organizationId: string;
  email: string;
  fullName: string | null;
  role: MemberRole;
  /** 株主ロールのアカウントが紐づく権利者（stakeholders.id）。社内メンバーは通常 null */
  stakeholderId: string | null;
}

// React の cache() でリクエスト単位にメモ化する。同一リクエスト内で複数回呼ばれても
// 認証サービスへの往復と profiles クエリは1回で済む（getSessionState も同じくメモ化している）。
// 例: Route Handler が getRequestLogger() と権限チェックの両方でこれを呼ぶケース。
// キャッシュはリクエストスコープのため、リクエストをまたいだ profile の持ち越しは起きない。
export const getCurrentProfile = cache(async (): Promise<CurrentProfile | null> => {
  const state = await getSessionState();
  if (!state.user || state.mfa !== 'ok') {
    return null;
  }
  return state.profile;
});

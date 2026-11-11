// 認証の操作（ログイン・二要素認証のコードの確認・要素の登録と解除）をサーバで行うための Supabase クライアント。
// src/lib/supabase/server.ts の createClient() と同じく、ユーザーのセッション（Cookie）を引き継ぐ。違いは 2 つ。
//
//   1. 利用者の接続元（IP アドレス・ブラウザ）を認証サービスへ伝える。
//      ログインをサーバ経由にすると、認証サービスから見た相手はこのサーバになる。そのままだと、
//      ログインの記録（auth.sessions → 監査ログの auth.login）の接続元がすべてサーバのものになり、
//      認証サービスの「接続元ごとの回数制限」も全利用者で 1 つの枠を分け合ってしまう。
//      X-Forwarded-For（自前で動かす構成・ローカル）と Sb-Forwarded-For（Supabase のホスティングで
//      「Sb-Forwarded-For を信頼する」設定を有効にした場合）の両方で渡す。
//   2. 「ログイン状態を保持する」を外した人（openstock-session-only の Cookie）には、
//      有効期限（Max-Age）の無い Cookie で書く（ブラウザを閉じるとログアウトする）。
//      @supabase/ssr はサーバ側では必ず 400 日の Max-Age を付けるため、書き込むときに外す。
//
// ⚠️ サーバ専用。Route Handler と Server Action からだけ使う（Server Component では Cookie を書けない）。

import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { auditContextFromHeaders } from '@/lib/audit/headers';
import { authCookieOptions, isHttpsRequest, SESSION_ONLY_COOKIE } from '@/lib/supabase/cookieNames';

export const createAuthServerClient = async () => {
  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const context = auditContextFromHeaders(requestHeaders);
  const sessionOnly = cookieStore.get(SESSION_ONLY_COOKIE)?.value === '1';

  const forwarded: Record<string, string> = {};
  if (context.ip) {
    forwarded['X-Forwarded-For'] = context.ip;
    forwarded['Sb-Forwarded-For'] = context.ip;
  }
  if (context.userAgent) {
    forwarded['User-Agent'] = context.userAgent;
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(isHttpsRequest(requestHeaders)),
      global: { headers: forwarded },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            // maxAge: 0 は「消す」指定なので、そのまま渡す
            if (sessionOnly && options?.maxAge !== 0) {
              const sessionCookieOptions = { ...options };
              delete sessionCookieOptions.maxAge;
              cookieStore.set(name, value, sessionCookieOptions);
              return;
            }
            cookieStore.set(name, value, options);
          });
        },
      },
    },
  );
};

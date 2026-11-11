import { createServerClient } from '@supabase/ssr';
import { cookies, headers } from 'next/headers';
import { authCookieOptions, isHttpsRequest } from './cookieNames';

/**
 * Server Component / Server Action / Route Handler 用の Supabase クライアント。
 * ユーザーのセッション（Cookie）を引き継ぐため、RLS がユーザー単位で適用される。
 */
export const createClient = async () => {
  const cookieStore = await cookies();
  const secure = isHttpsRequest(await headers());

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: authCookieOptions(secure),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component からの呼び出しでは Cookie を書き込めない。
            // セッション更新を middleware で行う場合は無視してよい。
          }
        },
      },
    },
  );
};

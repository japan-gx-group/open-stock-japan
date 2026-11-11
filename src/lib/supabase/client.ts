import { createBrowserClient } from '@supabase/ssr';
import { authCookieOptions, SESSION_ONLY_COOKIE } from './cookieNames';

// いま開いているページが HTTPS か（サーバでの描画中は判定できないので false）
const isHttpsPage = (): boolean => typeof window !== 'undefined' && window.location.protocol === 'https:';

const isSessionOnly = (): boolean => {
  if (typeof document === 'undefined') return false; // SSR 時は既定（永続）で扱う
  return document.cookie.split('; ').includes(`${SESSION_ONLY_COOKIE}=1`);
};

/**
 * ログイン時にユーザーの「ログイン状態を保持する」選択を記録する。
 * 以降のすべての createClient() がこの希望を読み取り、トークン自動更新で Cookie が
 * 書き換わる場合もセッション/永続の別を一貫させる（保持しない選択が更新で失われるのを防ぐ）。
 */
export const setSessionPersistence = (persist: boolean): void => {
  if (typeof document === 'undefined') return;
  document.cookie = persist
    ? `${SESSION_ONLY_COOKIE}=; path=/; max-age=0; samesite=lax` // 希望をクリア（既定=永続）
    : `${SESSION_ONLY_COOKIE}=1; path=/; samesite=lax`; // Max-Age 無し = セッション Cookie
};

/**
 * Client Component（ブラウザ）用の Supabase クライアント。
 * 使用してよいキーは NEXT_PUBLIC_ プレフィックス付きの2つのみ（RLS前提で公開可）。
 * SUPABASE_SERVICE_ROLE_KEY をここで参照してはいけない（docs/architecture.md 参照）。
 *
 * 「ログイン状態を保持する」が外れている（session-only）ときは認証 Cookie の maxAge を
 * 明示的に undefined で上書きする。@supabase/ssr の既定 400 日が外れ、Cookie シリアライズ時に
 * Max-Age が付かないセッション Cookie になるため、ブラウザを閉じるとログアウトする。
 */
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // HTTPS のページでは Secure を付ける（サーバ側の authCookieOptions と同じ決まり）
      cookieOptions: isSessionOnly()
        ? { ...authCookieOptions(isHttpsPage()), maxAge: undefined }
        : authCookieOptions(isHttpsPage()),
    },
  );

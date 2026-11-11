// このアプリが使う Cookie の名前（ブラウザ・サーバ・proxy.ts で同じ名前を使うため、ここを唯一の定義にする）。

// Supabase の認証セッション Cookie の名前。
// @supabase/ssr の既定は `sb-<Supabase の URL のホスト名の先頭>-auth-token` で、ローカル開発
// （http://127.0.0.1:<port>）ではどのプロジェクトでも `sb-127-auth-token` になる。Cookie はポートを
// 区別しないため、同じパソコンで別の Supabase アプリを動かすとセッションを上書きし合う。
// 固定の名前にして衝突を避ける。`sb-…-auth-token` の形は保つ
// （ResetPasswordForm がこの形で Cookie の有無を見る）。
export const AUTH_COOKIE_NAME = 'sb-openstock-auth-token';

// 「ログイン状態を保持する」の希望を記録する Cookie 名。値 '1' = 保持しない
// （ブラウザを閉じたらログアウト）。この Cookie 自体も Max-Age を付けない
// セッション Cookie にするため、ブラウザを閉じれば設定ごと消える。
export const SESSION_ONLY_COOKIE = 'openstock-session-only';

// HTTPS で届いたリクエストか。プロキシの後ろでは、アプリには http で届くので x-forwarded-proto を見る。
// APP_URL が https なら、ヘッダにかかわらず HTTPS として扱う。
export const isHttpsRequest = (headers: { get(name: string): string | null }, protocol?: string): boolean => {
  if (process.env.APP_URL?.trim().toLowerCase().startsWith('https://')) return true;
  const forwarded = headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  return (forwarded || protocol?.replace(':', '').toLowerCase()) === 'https';
};

// 認証 Cookie の属性。HTTPS のときは Secure を付け、暗号化されていない通信には載せない。
// HttpOnly は付けられない（ブラウザ側の Supabase クライアントが、この Cookie からセッションを読むため）。
export const authCookieOptions = (secure: boolean): { name: string; secure?: true } =>
  secure ? { name: AUTH_COOKIE_NAME, secure: true } : { name: AUTH_COOKIE_NAME };


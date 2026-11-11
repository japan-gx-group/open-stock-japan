// セッションの有効期限（画面の案内に出す値）。実際に切るのは認証サービス（Supabase Auth）で、ここは表示だけ。
// 値を変えるときは、認証サービスの設定と必ず合わせること。
//   ローカル: supabase/config.toml の [auth.sessions] timebox / inactivity_timeout
//   本番    : Supabase のダッシュボード Authentication > Sessions の
//             「Time-box user sessions」と「Inactivity timeout」

/** ログインしてからこの時間がたつと、操作中でもログインし直しになる */
export const SESSION_TIMEBOX_HOURS = 24;

/** 何も操作しないままこの時間がたつと、ログインし直しになる */
export const SESSION_INACTIVITY_HOURS = 8;

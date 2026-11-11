// 「メールのリンクから、いま入ってきたセッション」かどうかを、アクセストークンの中身から判定する。
//
// パスワードの再設定は、現在のパスワードを知らなくても新しいパスワードを設定できる。許してよいのは、
// メールに届いた再設定リンクを踏んだ直後のセッションだけ。以前は「再設定リンクを踏んだ」ことの目印を
// Cookie（openstock-pw-recovery=1）だけで持っていたが、Cookie はブラウザが好きな値を送れるので、
// ログイン中のセッションを手に入れた人が、目印を自分で付けてパスワードを変えられた。
//
// 認証サービス（Supabase Auth）は、アクセストークンの amr に「どの方法で・いつ本人確認したか」を入れる。
//   パスワードでのログイン … { method: 'password' }
//   メールのリンク（再設定・マジックリンク）… { method: 'otp' }（版によっては 'recovery' / 'magiclink'）
// トークンは認証サービスの署名つきで、ブラウザは書き換えられない。
//
// ⚠ ここは、署名を確かめない。必ず、auth.getUser(token) で認証サービスがそのトークンを受け付けたあとに使うこと。

/** メールのリンクを踏んでから、再設定を終えるまでに許す時間（秒） */
export const RECOVERY_SESSION_MAX_AGE_SECONDS = 15 * 60;

// サーバどうしの時計のずれとして許す幅（秒）
const CLOCK_SKEW_SECONDS = 60;

const EMAIL_LINK_METHODS = new Set(['otp', 'recovery', 'magiclink']);

const decodePayload = (accessToken: string): Record<string, unknown> | null => {
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const payload: unknown = JSON.parse(json);
    return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * メールのリンク（再設定など）で本人確認してから、決まった時間の内にあるセッションか。
 * パスワードでログインしただけのセッションは false。
 */
export const isRecentEmailLinkSession = (
  accessToken: string | null | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean => {
  if (!accessToken) return false;
  const amr = decodePayload(accessToken)?.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (typeof method !== 'string' || !EMAIL_LINK_METHODS.has(method)) return false;
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) return false;
    const age = nowSeconds - timestamp;
    return age >= -CLOCK_SKEW_SECONDS && age <= RECOVERY_SESSION_MAX_AGE_SECONDS;
  });
};

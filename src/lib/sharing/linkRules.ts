// 共有リンクの決まり（有効期間の範囲・状態の判定・トークンの形）。ブラウザとサーバの両方で使う。
//
// ここには node: のモジュールを読み込まない。ブラウザ側（共有ダイアログ）がこのファイルを読み込むので、
// node:crypto などを入れると、その代替実装（数百 KB。eval を含む）がブラウザ用のバンドルに入ってしまう。
// トークンの生成とハッシュ（node:crypto を使う）は、サーバ専用の token.ts に置く。

export const SHARE_LINK_MIN_DAYS = 1;
export const SHARE_LINK_MAX_DAYS = 90;
export const SHARE_LINK_DEFAULT_DAYS = 14;

// 32 バイトの乱数を base64url にしたもの（43 文字）
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** トークンの形（32 バイトの base64url）か。形が違うものは DB を引く前に落とす */
export const isShareTokenFormat = (value: unknown): value is string => typeof value === 'string' && TOKEN_PATTERN.test(value);

export type ShareLinkStatus = 'active' | 'expired' | 'revoked';

export const shareLinkStatus = (
  link: { expiresAt: string; revokedAt: string | null },
  now: Date = new Date(),
): ShareLinkStatus => {
  if (link.revokedAt) return 'revoked';
  const expires = new Date(link.expiresAt).getTime();
  return Number.isFinite(expires) && expires > now.getTime() ? 'active' : 'expired';
};

/** 有効期間（日）の入力を検証する。1〜90 の整数だけを受け付ける */
export const parseExpiryDays = (value: unknown): number | null => {
  const days = typeof value === 'number' ? value : typeof value === 'string' && /^\d{1,3}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isInteger(days) || days < SHARE_LINK_MIN_DAYS || days > SHARE_LINK_MAX_DAYS) return null;
  return days;
};

export const expiryFromDays = (days: number, now: Date = new Date()): string =>
  new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

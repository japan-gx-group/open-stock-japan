// 二要素認証（TOTP）のコードの入力まわりの共通部品（純粋な関数と文言。ブラウザ・サーバで共通）。

/** 認証アプリに登録できる機器の数（ふだん使う 1 台 + 予備の 1 台） */
export const MAX_MFA_FACTORS = 2;

export const MFA_MESSAGES = {
  invalidFormat: 'コードは6桁の数字で入力してください。',
  wrongCode: 'コードが正しくありません。認証アプリに表示されている最新の6桁のコードを入力してください。',
  signedOut: 'セッションが確認できません。ログインし直してください。',
  serviceError: 'コードを確認できませんでした。時間をおいて再度お試しください。',
} as const;

export const mfaLockedMessage = (remainingMinutes: number): string =>
  `コードの入力の失敗が続いたため、確認を一時的に停止しています。約${remainingMinutes}分後に再度お試しください。`;

/**
 * 入力されたコードを 6 桁の数字にそろえる（空白・ハイフンを除き、全角の数字は半角にする）。
 * 6 桁の数字でなければ null。
 */
export const normalizeMfaCode = (input: unknown): string | null => {
  if (typeof input !== 'string') return null;
  const digits = input
    .replace(/[\s-]/g, '')
    .replace(/[０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
  return /^\d{6}$/.test(digits) ? digits : null;
};

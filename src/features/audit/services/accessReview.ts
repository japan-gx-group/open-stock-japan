// アカウントの棚卸し（アクセス権の定期的な見直し）の判定。サーバ依存なしの純粋な関数。

import type { AccountStatus } from '../types';

/** この日数を超えてログインが無いアカウントを「長期間ログインなし」として目立たせる */
export const DORMANT_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

const timeOf = (value: string | null | undefined): number | null => {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
};

/**
 * アカウントの状態。
 *   banned  … 停止中（ログインできない）
 *   never   … 一度もログインしていない
 *   dormant … 最後のログインから DORMANT_DAYS 日を超えている
 *   active  … 利用中
 */
export const accountStatusOf = (
  account: { lastSignInAt: string | null; bannedUntil: string | null },
  now: Date = new Date(),
): AccountStatus => {
  const bannedUntil = timeOf(account.bannedUntil);
  if (bannedUntil != null && bannedUntil > now.getTime()) return 'banned';
  const lastSignIn = timeOf(account.lastSignInAt);
  if (lastSignIn == null) return 'never';
  return now.getTime() - lastSignIn > DORMANT_DAYS * DAY_MS ? 'dormant' : 'active';
};

/** 招待が期限切れか */
export const isInviteExpired = (expiresAt: string, now: Date = new Date()): boolean => {
  const time = timeOf(expiresAt);
  return time == null || time <= now.getTime();
};

/** 最後のログインからの日数（切り捨て）。ログインしていなければ null */
export const daysSinceLastSignIn = (lastSignInAt: string | null, now: Date = new Date()): number | null => {
  const time = timeOf(lastSignInAt);
  return time == null ? null : Math.max(0, Math.floor((now.getTime() - time) / DAY_MS));
};

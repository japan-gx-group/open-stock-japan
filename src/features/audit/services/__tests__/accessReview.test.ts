import { describe, expect, it } from 'vitest';
import { accountStatusOf, daysSinceLastSignIn, DORMANT_DAYS, isInviteExpired } from '../accessReview';

const NOW = new Date('2026-11-11T00:00:00Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe('accountStatusOf', () => {
  it('最近ログインしていれば利用中', () => {
    expect(accountStatusOf({ lastSignInAt: daysAgo(1), bannedUntil: null }, NOW)).toBe('active');
    expect(accountStatusOf({ lastSignInAt: daysAgo(DORMANT_DAYS), bannedUntil: null }, NOW)).toBe('active');
  });

  it('一度もログインしていなければ未ログイン', () => {
    expect(accountStatusOf({ lastSignInAt: null, bannedUntil: null }, NOW)).toBe('never');
  });

  it('決めた日数を超えてログインが無ければ、長期間ログインなし', () => {
    expect(accountStatusOf({ lastSignInAt: daysAgo(DORMANT_DAYS + 1), bannedUntil: null }, NOW)).toBe('dormant');
  });

  it('停止中（停止の期限が先）は、ログインの有無より優先する。期限を過ぎた停止は数えない', () => {
    expect(accountStatusOf({ lastSignInAt: daysAgo(1), bannedUntil: '2027-01-01T00:00:00Z' }, NOW)).toBe('banned');
    expect(accountStatusOf({ lastSignInAt: null, bannedUntil: '2027-01-01T00:00:00Z' }, NOW)).toBe('banned');
    expect(accountStatusOf({ lastSignInAt: daysAgo(1), bannedUntil: '2026-01-01T00:00:00Z' }, NOW)).toBe('active');
  });
});

describe('isInviteExpired / daysSinceLastSignIn', () => {
  it('有効期限がいま以前なら期限切れ。読めない値も期限切れとして扱う', () => {
    expect(isInviteExpired('2026-11-12T00:00:00Z', NOW)).toBe(false);
    expect(isInviteExpired('2026-11-11T00:00:00Z', NOW)).toBe(true);
    expect(isInviteExpired('2026-11-01T00:00:00Z', NOW)).toBe(true);
    expect(isInviteExpired('', NOW)).toBe(true);
  });

  it('最後のログインからの日数（切り捨て）', () => {
    expect(daysSinceLastSignIn(daysAgo(0.5), NOW)).toBe(0);
    expect(daysSinceLastSignIn(daysAgo(3.9), NOW)).toBe(3);
    expect(daysSinceLastSignIn(null, NOW)).toBeNull();
    // 時計のずれで未来になっても負にしない
    expect(daysSinceLastSignIn('2026-11-12T00:00:00Z', NOW)).toBe(0);
  });
});

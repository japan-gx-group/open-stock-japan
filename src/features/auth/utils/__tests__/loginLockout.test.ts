import { describe, expect, it } from 'vitest';
import {
  LOGIN_LOCKOUT_RULE,
  MFA_LOCKOUT_RULE,
  evaluateLockout,
  lockoutWindowMinutes,
  remainingLockMinutes,
} from '../loginLockout';

const MIN = 60_000;
const NOW = Date.UTC(2026, 10, 11, 12, 0, 0);
/** now の何分前か（負の値は未来） */
const ago = (...minutes: number[]) => minutes.map((minute) => NOW - minute * MIN);

describe('決まり', () => {
  it('15 分のあいだに 5 回の失敗で、15 分間止める（ログインも二要素認証も同じ）', () => {
    expect(LOGIN_LOCKOUT_RULE).toEqual({ maxFailures: 5, windowMs: 15 * MIN });
    expect(MFA_LOCKOUT_RULE).toEqual(LOGIN_LOCKOUT_RULE);
    expect(lockoutWindowMinutes()).toBe(15);
  });
});

describe('evaluateLockout', () => {
  it('失敗が無ければ止めない', () => {
    expect(evaluateLockout([], NOW)).toEqual({ locked: false, lockedUntil: null, failureCount: 0 });
  });

  it('4 回までは止めず、回数を数える', () => {
    expect(evaluateLockout(ago(4, 3, 2, 1), NOW)).toEqual({ locked: false, lockedUntil: null, failureCount: 4 });
  });

  it('5 回目の失敗から 15 分間止める', () => {
    const status = evaluateLockout(ago(10, 8, 6, 4, 2), NOW);
    expect(status.locked).toBe(true);
    expect(status.failureCount).toBe(5);
    // 5 回目（2 分前）から 15 分 = いまから 13 分後まで
    expect(status.lockedUntil).toBe(NOW + 13 * MIN);
    expect(remainingLockMinutes(status.lockedUntil!, NOW)).toBe(13);
  });

  it('渡す順番に左右されない', () => {
    expect(evaluateLockout(ago(2, 10, 4, 8, 6), NOW)).toEqual(evaluateLockout(ago(10, 8, 6, 4, 2), NOW));
  });

  it('15 分より前の失敗は数えない（4 回 + 16 分前の 1 回 = 4 回）', () => {
    expect(evaluateLockout(ago(16, 4, 3, 2, 1), NOW)).toEqual({ locked: false, lockedUntil: null, failureCount: 4 });
  });

  it('5 回が 15 分のあいだに収まっていなければ止めない', () => {
    // 20 分前から 4 分おき。どの 15 分を取っても 4 回まで
    expect(evaluateLockout(ago(20, 16, 12, 8, 4), NOW).locked).toBe(false);
  });

  it('最初の失敗が 15 分より前になっても、5 回目から 15 分たつまでは止めたまま', () => {
    // 5 回目は 3 分前。最初の失敗（16 分前）はもう窓の外だが、ロックは 5 回目が基準
    const status = evaluateLockout(ago(16, 12, 9, 6, 3), NOW);
    expect(status.locked).toBe(true);
    expect(status.lockedUntil).toBe(NOW + 12 * MIN);
  });

  it('15 分たてば解け、数え直す（止める前の失敗は持ち越さない）', () => {
    // 5 回目が 15 分ちょうど前 → いま解けた
    expect(evaluateLockout(ago(20, 19, 18, 17, 15), NOW)).toEqual({ locked: false, lockedUntil: null, failureCount: 0 });
    // 解けたあとの失敗は 1 回目から
    expect(evaluateLockout(ago(25, 24, 23, 22, 21, 2, 1), NOW)).toEqual({ locked: false, lockedUntil: null, failureCount: 2 });
  });

  it('解けたあと、また 5 回失敗すれば止める', () => {
    const status = evaluateLockout(ago(29, 28, 27, 26, 25, 9, 8, 7, 6, 5), NOW);
    expect(status.locked).toBe(true);
    expect(status.lockedUntil).toBe(NOW + 10 * MIN);
  });

  it('止めているあいだに残った失敗（同時の要求など）は数えず、ロックを延ばさない', () => {
    const base = evaluateLockout(ago(10, 9, 8, 7, 6), NOW);
    const withExtras = evaluateLockout(ago(10, 9, 8, 7, 6, 5.9, 5, 3, 1), NOW);
    expect(withExtras).toEqual(base);
    expect(withExtras.lockedUntil).toBe(NOW + 9 * MIN);
  });

  it('同時に届いた 6 回以上の失敗でも、ロックは 5 回目が基準', () => {
    const times = Array.from({ length: 12 }, () => NOW - 1 * MIN);
    expect(evaluateLockout(times, NOW).lockedUntil).toBe(NOW + 14 * MIN);
  });

  it('時計のずれで未来に見える失敗は、いまの失敗として数える', () => {
    const status = evaluateLockout([...ago(4, 3, 2, 1), NOW + 5_000], NOW);
    expect(status.locked).toBe(true);
    expect(status.lockedUntil).toBe(NOW + 15 * MIN);
  });

  it('決まりを変えて使える', () => {
    const rule = { maxFailures: 3, windowMs: 5 * MIN };
    expect(evaluateLockout(ago(3, 2, 1), NOW, rule)).toEqual({ locked: true, lockedUntil: NOW + 4 * MIN, failureCount: 3 });
    expect(evaluateLockout(ago(6, 2, 1), NOW, rule)).toEqual({ locked: false, lockedUntil: null, failureCount: 2 });
  });
});

describe('remainingLockMinutes', () => {
  it('切り上げて、最小 1 分', () => {
    expect(remainingLockMinutes(NOW + 15 * MIN, NOW)).toBe(15);
    expect(remainingLockMinutes(NOW + 14 * MIN + 1, NOW)).toBe(15);
    expect(remainingLockMinutes(NOW + 10_000, NOW)).toBe(1);
    expect(remainingLockMinutes(NOW - 10_000, NOW)).toBe(1);
  });
});

import { describe, expect, it } from 'vitest';
import { isRecentEmailLinkSession, RECOVERY_SESSION_MAX_AGE_SECONDS } from '../recoverySession';

// 「メールのリンクを踏んで、いま入ってきたセッション」だけを、パスワードの再設定に通すための判定。

const NOW = 1_800_000_000;
const tokenWith = (payload: unknown): string => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256' })}.${encode(payload)}.signature`;
};

describe('isRecentEmailLinkSession', () => {
  it('メールのリンク（otp・recovery・magiclink）で、決まった時間の内なら true', () => {
    for (const method of ['otp', 'recovery', 'magiclink']) {
      expect(isRecentEmailLinkSession(tokenWith({ amr: [{ method, timestamp: NOW - 60 }] }), NOW), method).toBe(true);
    }
    expect(isRecentEmailLinkSession(tokenWith({ amr: [{ method: 'otp', timestamp: NOW - RECOVERY_SESSION_MAX_AGE_SECONDS }] }), NOW)).toBe(true);
  });

  it('パスワードでのログイン・二要素認証のコードだけでは false', () => {
    expect(isRecentEmailLinkSession(tokenWith({ amr: [{ method: 'password', timestamp: NOW - 10 }] }), NOW)).toBe(false);
    expect(
      isRecentEmailLinkSession(tokenWith({ amr: [{ method: 'totp', timestamp: NOW - 5 }, { method: 'password', timestamp: NOW - 10 }] }), NOW),
    ).toBe(false);
  });

  it('時間が経ちすぎたもの・先の時刻のものは false', () => {
    expect(isRecentEmailLinkSession(tokenWith({ amr: [{ method: 'otp', timestamp: NOW - RECOVERY_SESSION_MAX_AGE_SECONDS - 1 }] }), NOW)).toBe(false);
    expect(isRecentEmailLinkSession(tokenWith({ amr: [{ method: 'otp', timestamp: NOW + 3600 }] }), NOW)).toBe(false);
  });

  it('形の崩れたトークン・amr は false（例外を投げない）', () => {
    for (const token of [null, undefined, '', 'abc', 'a.b', 'a.b.c', tokenWith({}), tokenWith({ amr: 'otp' }), tokenWith({ amr: ['otp'] }), tokenWith({ amr: [{ method: 'otp' }] }), tokenWith({ amr: [{ method: 'otp', timestamp: 'now' }] }), tokenWith(null)]) {
      expect(isRecentEmailLinkSession(token, NOW), String(token)).toBe(false);
    }
  });
});

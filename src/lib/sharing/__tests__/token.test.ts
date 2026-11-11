import { describe, expect, it } from 'vitest';
import {
  expiryFromDays,
  generateShareToken,
  hashShareToken,
  isShareTokenFormat,
  parseExpiryDays,
  shareLinkStatus,
} from '../token';
import {
  clientKeyOf,
  consumeShareLookupQuota,
  resetShareLookupQuota,
  SHARE_LOOKUP_LIMIT_GLOBAL,
  SHARE_LOOKUP_LIMIT_PER_CLIENT,
} from '../rateLimit';

describe('共有リンクのトークン', () => {
  it('32 バイトの base64url（43 文字）で、毎回違う', () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isShareTokenFormat(a)).toBe(true);
  });

  it('形の違うものは受け付けない', () => {
    expect(isShareTokenFormat('')).toBe(false);
    expect(isShareTokenFormat('abc')).toBe(false);
    expect(isShareTokenFormat(`${'a'.repeat(42)}/`)).toBe(false);
    expect(isShareTokenFormat('a'.repeat(44))).toBe(false);
    expect(isShareTokenFormat(null)).toBe(false);
  });

  it('保存するのは SHA-256 の 16 進 64 文字で、トークンを含まない', () => {
    const token = generateShareToken();
    const hash = hashShareToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hashShareToken(token)).toBe(hash);
    expect(hashShareToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('共有リンクの状態', () => {
  const now = new Date('2026-11-11T00:00:00Z');
  it('期限内は有効、期限ちょうど・期限後は期限切れ', () => {
    expect(shareLinkStatus({ expiresAt: '2026-11-11T00:00:01Z', revokedAt: null }, now)).toBe('active');
    expect(shareLinkStatus({ expiresAt: '2026-11-11T00:00:00Z', revokedAt: null }, now)).toBe('expired');
    expect(shareLinkStatus({ expiresAt: '2026-11-10T00:00:00Z', revokedAt: null }, now)).toBe('expired');
  });
  it('取り消しは期限より優先する', () => {
    expect(shareLinkStatus({ expiresAt: '2026-12-01T00:00:00Z', revokedAt: '2026-11-01T00:00:00Z' }, now)).toBe('revoked');
  });
  it('読めない期限は期限切れとして扱う', () => {
    expect(shareLinkStatus({ expiresAt: 'x', revokedAt: null }, now)).toBe('expired');
  });
});

describe('有効期間の入力', () => {
  it('1〜90 の整数だけを受け付ける', () => {
    expect(parseExpiryDays(1)).toBe(1);
    expect(parseExpiryDays('14')).toBe(14);
    expect(parseExpiryDays(90)).toBe(90);
    expect(parseExpiryDays(0)).toBeNull();
    expect(parseExpiryDays(91)).toBeNull();
    expect(parseExpiryDays(1.5)).toBeNull();
    expect(parseExpiryDays('-1')).toBeNull();
    expect(parseExpiryDays('1e1')).toBeNull();
    expect(parseExpiryDays(null)).toBeNull();
  });
  it('期限は日数分だけ先', () => {
    expect(expiryFromDays(14, new Date('2026-11-11T00:00:00Z'))).toBe('2026-11-25T00:00:00.000Z');
  });
});

describe('トークン照会の回数制限', () => {
  // 利用者が書いた値（左）と、手前のプロキシが足した本当の接続元（右）
  const headers = (ip: string) => new Headers({ 'x-forwarded-for': `198.51.100.250, ${ip}` });
  it('送信元は、信頼できるプロキシが足した値（x-forwarded-for のいちばん右）。無ければ x-real-ip', () => {
    expect(clientKeyOf(headers('203.0.113.5'))).toBe('203.0.113.5');
    expect(clientKeyOf(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientKeyOf(new Headers())).toBe('unknown');
  });
  it('利用者が x-forwarded-for の先頭を書き換えても、別の送信元としては数えない', () => {
    resetShareLookupQuota();
    const t = 2_000_000;
    const spoofed = (fake: string) => new Headers({ 'x-forwarded-for': `${fake}, 203.0.113.5` });
    for (let i = 0; i < SHARE_LOOKUP_LIMIT_PER_CLIENT; i += 1) expect(consumeShareLookupQuota(spoofed(`198.51.100.${i}`), t)).toBe(true);
    expect(consumeShareLookupQuota(spoofed('198.51.100.200'), t)).toBe(false);
    resetShareLookupQuota();
  });
  it('同じ送信元は上限を超えると拒否され、窓が明ければ戻る', () => {
    resetShareLookupQuota();
    const t = 1_000_000;
    for (let i = 0; i < SHARE_LOOKUP_LIMIT_PER_CLIENT; i += 1) expect(consumeShareLookupQuota(headers('203.0.113.5'), t)).toBe(true);
    expect(consumeShareLookupQuota(headers('203.0.113.5'), t)).toBe(false);
    expect(consumeShareLookupQuota(headers('203.0.113.6'), t)).toBe(true);
    expect(consumeShareLookupQuota(headers('203.0.113.5'), t + 61_000)).toBe(true);
    resetShareLookupQuota();
  });
  it('1 つの送信元が上限を超えて叩き続けても、全体の枠は減らない（ほかの人の共有リンクを止めない）', () => {
    resetShareLookupQuota();
    const t = 3_000_000;
    // 上限を超えたあとの呼び出しを、全体の上限より多く繰り返す
    for (let i = 0; i < SHARE_LOOKUP_LIMIT_GLOBAL + SHARE_LOOKUP_LIMIT_PER_CLIENT + 50; i += 1) consumeShareLookupQuota(headers('203.0.113.5'), t);
    expect(consumeShareLookupQuota(headers('203.0.113.77'), t)).toBe(true);
    resetShareLookupQuota();
  });
});

import { describe, expect, it } from 'vitest';
import { INTERNAL_ROLES, MEMBER_ROLES, isInternal } from '@/types/role';
import { decideMfaState, mfaRedirectUrl, readAalFromAccessToken, verifiedFactors } from '../mfaState';

const base = { verifiedFactorCount: 0, aal: 'aal1' as const, role: 'logger' as const, requireMfaForInternal: false };

describe('decideMfaState', () => {
  it('要素なし・組織の必須なし → そのまま使える', () => {
    for (const role of MEMBER_ROLES) {
      expect(decideMfaState({ ...base, role }), role).toBe('ok');
    }
  });

  it('確認済みの要素があり、セッションが aal1 → コードの確認が要る（ロール・組織の設定によらない）', () => {
    for (const role of [...MEMBER_ROLES, null]) {
      for (const requireMfaForInternal of [false, true]) {
        expect(decideMfaState({ verifiedFactorCount: 1, aal: 'aal1', role, requireMfaForInternal })).toBe('challenge');
      }
    }
  });

  it('確認済みの要素があり、セッションが aal2 → 使える', () => {
    for (const role of MEMBER_ROLES) {
      expect(decideMfaState({ verifiedFactorCount: 2, aal: 'aal2', role, requireMfaForInternal: true })).toBe('ok');
    }
  });

  it('aal が読めないときは、確認していない扱いにする', () => {
    expect(decideMfaState({ ...base, verifiedFactorCount: 1, aal: null })).toBe('challenge');
  });

  it('組織が必須にしていて、社内のロールで、要素なし → 登録が要る', () => {
    for (const role of INTERNAL_ROLES) {
      expect(decideMfaState({ ...base, role, requireMfaForInternal: true }), role).toBe('enroll');
    }
  });

  it('社内のロールの判定は isInternal に任せる（ロールが増えても同じ結果になる）', () => {
    for (const role of MEMBER_ROLES) {
      expect(decideMfaState({ ...base, role, requireMfaForInternal: true })).toBe(isInternal(role) ? 'enroll' : 'ok');
    }
  });

  it('組織が必須にしていても、株主ロールとプロフィールの無い人は登録を求めない', () => {
    expect(decideMfaState({ ...base, role: 'shareholder', requireMfaForInternal: true })).toBe('ok');
    expect(decideMfaState({ ...base, role: null, requireMfaForInternal: true })).toBe('ok');
  });

  it('要素を解除した直後（トークンは aal2 のまま・要素なし）は、組織の設定で決まる', () => {
    expect(decideMfaState({ ...base, aal: 'aal2' })).toBe('ok');
    expect(decideMfaState({ ...base, aal: 'aal2', requireMfaForInternal: true })).toBe('enroll');
  });
});

describe('verifiedFactors', () => {
  it('確認済みの要素だけを返す（登録の途中のものは数えない）', () => {
    const factors = [
      { id: 'a', status: 'verified' },
      { id: 'b', status: 'unverified' },
      { id: 'c', status: 'verified' },
    ];
    expect(verifiedFactors(factors).map((factor) => factor.id)).toEqual(['a', 'c']);
    expect(verifiedFactors(undefined)).toEqual([]);
    expect(verifiedFactors(null)).toEqual([]);
  });
});

const token = (payload: unknown): string => {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
};

describe('readAalFromAccessToken', () => {
  it('トークンの本体から aal を読む', () => {
    expect(readAalFromAccessToken(token({ sub: 'u', aal: 'aal1' }))).toBe('aal1');
    expect(readAalFromAccessToken(token({ sub: 'u', aal: 'aal2', amr: [{ method: 'totp' }] }))).toBe('aal2');
  });

  it('日本語を含む本体でも読める', () => {
    expect(readAalFromAccessToken(token({ aal: 'aal2', user_metadata: { full_name: '管理 花子' } }))).toBe('aal2');
  });

  it('aal が無い・想定外の値・壊れたトークンは null（＝確認していない扱い）', () => {
    expect(readAalFromAccessToken(token({ sub: 'u' }))).toBeNull();
    expect(readAalFromAccessToken(token({ aal: 'aal3' }))).toBeNull();
    expect(readAalFromAccessToken(token({ aal: true }))).toBeNull();
    expect(readAalFromAccessToken('not-a-jwt')).toBeNull();
    expect(readAalFromAccessToken('a.b')).toBeNull();
    expect(readAalFromAccessToken('a.%%%.c')).toBeNull();
    expect(readAalFromAccessToken('')).toBeNull();
    expect(readAalFromAccessToken(null)).toBeNull();
    expect(readAalFromAccessToken(undefined)).toBeNull();
  });
});

describe('mfaRedirectUrl', () => {
  it('確認は /mfa、登録は /mfa/setup。元の行き先を next で引き継ぐ', () => {
    expect(mfaRedirectUrl('challenge')).toBe('/mfa');
    expect(mfaRedirectUrl('enroll')).toBe('/mfa/setup');
    expect(mfaRedirectUrl('challenge', '/shareholders?tab=1')).toBe('/mfa?next=%2Fshareholders%3Ftab%3D1');
    expect(mfaRedirectUrl('enroll', null)).toBe('/mfa/setup');
  });
});

import { describe, expect, it } from 'vitest';
import { getPostMfaPath, getSafeRedirectPath, toSafeInternalPath } from '../redirect';

// 外部のサイトへ出てしまう入力。どれも、ブラウザが解釈すると別のサイト（evil.example）を指す。
// 公開前のセキュリティの点検で、タブを挟んだ形（'/<タブ>/evil.example'）が検査をすり抜け、
// パスワードの再設定リンクと組み合わせるとセッションの情報が外部へ渡ることが分かった。
const EXTERNAL_INPUTS = [
  'https://evil.example',
  '//evil.example',
  '/\\evil.example',
  '/\t/evil.example',
  '/\n/evil.example',
  '/\r/evil.example',
  '/\t//evil.example',
  '\t//evil.example',
  '/.//evil.example',
  '/..//evil.example',
  '/a/..//evil.example',
  '/\\/evil.example',
  '/\u0000/evil.example',
  '/\u000b/evil.example',
  '/\u007f/evil.example',
  ' /evil',
  'javascript:alert(1)',
  'evil.example',
  '',
];

describe('toSafeInternalPath', () => {
  it('同じサイトの中のパスとクエリを通す', () => {
    expect(toSafeInternalPath('/shareholders?tab=stakeholders')).toBe('/shareholders?tab=stakeholders');
    expect(toSafeInternalPath('/shareholder-meetings/ee000000-0000-0000-0000-000000000001')).toBe(
      '/shareholder-meetings/ee000000-0000-0000-0000-000000000001',
    );
    expect(toSafeInternalPath('/')).toBe('/');
  });

  it('外部のサイトを指す入力は、どの形でも通さない', () => {
    for (const value of EXTERNAL_INPUTS) {
      expect(toSafeInternalPath(value), JSON.stringify(value)).toBeNull();
    }
    expect(toSafeInternalPath(null)).toBeNull();
    expect(toSafeInternalPath(undefined)).toBeNull();
  });

  it('通した値を、起点の違う URL として解釈しても、同じサイトの中に収まる', () => {
    for (const value of ['/dashboard', '/a/../b?x=//evil.example', '/%09/evil.example', '/%2F%2Fevil.example', '/x?next=https://evil.example']) {
      const safe = toSafeInternalPath(value);
      expect(safe, value).not.toBeNull();
      expect(new URL(safe as string, 'https://app.example').origin, value).toBe('https://app.example');
    }
  });

  it('# から後ろ（フラグメント）は落とす', () => {
    expect(toSafeInternalPath('/dashboard#access_token=abc')).toBe('/dashboard');
  });
});

describe('getSafeRedirectPath', () => {
  it('安全な相対パスはそのまま、それ以外は /dashboard', () => {
    expect(getSafeRedirectPath('/shareholders?tab=1')).toBe('/shareholders?tab=1');
    for (const value of [null, '', 'https://evil.example.com', '//evil.example.com', '/\\evil.example.com', 'dashboard']) {
      expect(getSafeRedirectPath(value)).toBe('/dashboard');
    }
  });

  it('外部のサイトを指す入力は、すべて /dashboard に倒す', () => {
    for (const value of EXTERNAL_INPUTS) {
      expect(getSafeRedirectPath(value), JSON.stringify(value)).toBe('/dashboard');
    }
  });
});

describe('getPostMfaPath', () => {
  it('next が無ければ、ロールごとの最初の画面', () => {
    expect(getPostMfaPath(null, false)).toBe('/dashboard');
    expect(getPostMfaPath(null, true)).toBe('/external-portal');
  });

  it('安全な相対パスの next はそのまま', () => {
    expect(getPostMfaPath('/cap-table?year=2026', false)).toBe('/cap-table?year=2026');
    expect(getPostMfaPath('/external-portal/holdings', true)).toBe('/external-portal/holdings');
  });

  it('外部の URL は使わない（オープンリダイレクト対策）', () => {
    for (const value of ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com', ...EXTERNAL_INPUTS]) {
      expect(getPostMfaPath(value, false), JSON.stringify(value)).toBe('/dashboard');
      expect(getPostMfaPath(value, true), JSON.stringify(value)).toBe('/external-portal');
      expect(getPostMfaPath(value, false, { allowSetup: true }), JSON.stringify(value)).toBe('/dashboard');
    }
  });

  it('認証の画面そのものへは戻さない（行き来が止まらなくなる）', () => {
    for (const value of ['/mfa', '/mfa?next=%2Fmfa', '/mfa/setup', '/mfa/setup?next=/x', '/mfa/anything', '/login', '/login?next=/mfa']) {
      expect(getPostMfaPath(value, false), value).toBe('/dashboard');
    }
  });

  it('コードの確認のあとに設定の画面を開く場合だけ、/mfa/setup を許す（クエリは落とす）', () => {
    expect(getPostMfaPath('/mfa/setup', false, { allowSetup: true })).toBe('/mfa/setup');
    expect(getPostMfaPath('/mfa/setup?next=%2Fmfa', true, { allowSetup: true })).toBe('/mfa/setup');
    expect(getPostMfaPath('/mfa', false, { allowSetup: true })).toBe('/dashboard');
  });

  it('/mfa で始まる別の画面は対象にしない', () => {
    expect(getPostMfaPath('/mfa-report', false)).toBe('/mfa-report');
  });
});

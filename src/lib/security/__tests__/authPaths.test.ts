import { describe, expect, it } from 'vitest';
import { isAuthPath, isHealthPath, isMfaPath, isPublicAssetPath, isPublicAuthApiPath, isPublicSharePath, requiresSameOrigin } from '../authPaths';

describe('isAuthPath', () => {
  it('認証系の画面だけを通す', () => {
    for (const path of ['/login', '/signup', '/forgot-password', '/reset-password', '/invite/abc']) {
      expect(isAuthPath(path)).toBe(true);
    }
    for (const path of ['/', '/dashboard', '/external-portal', '/invite', '/login/x', '/share/abc', '/api/documents']) {
      expect(isAuthPath(path)).toBe(false);
    }
  });
});

describe('isPublicSharePath', () => {
  it('/share/ 配下だけをログイン不要にする', () => {
    expect(isPublicSharePath('/share/abc')).toBe(true);
    expect(isPublicSharePath('/share/abc/download')).toBe(true);
  });
  it('それ以外は対象にしない', () => {
    for (const path of ['/share', '/share/', '/shared/abc', '/api/share-links', '/api/share/abc', '/external-portal', '/x/share/abc', '/login']) {
      expect(isPublicSharePath(path)).toBe(false);
    }
  });
  it('認証系の画面とは重ならない（ログイン中でも /dashboard へ送らない）', () => {
    expect(isAuthPath('/share/abc')).toBe(false);
  });
});

describe('isPublicAuthApiPath', () => {
  it('未ログインで呼べる API は、ログインの API の 1 本だけ（完全一致）', () => {
    expect(isPublicAuthApiPath('/api/auth/login')).toBe(true);
    for (const path of ['/api/auth', '/api/auth/', '/api/auth/login/', '/api/auth/login/x', '/api/auth/mfa', '/api/auth/logout', '/api/account/delete', '/login']) {
      expect(isPublicAuthApiPath(path), path).toBe(false);
    }
  });
  it('認証系の画面とは重ならない（ログイン中の人が呼んでも /dashboard へ送らない）', () => {
    expect(isAuthPath('/api/auth/login')).toBe(false);
  });
});

describe('isMfaPath', () => {
  it('二要素認証の画面は /mfa と /mfa/setup', () => {
    expect(isMfaPath('/mfa')).toBe(true);
    expect(isMfaPath('/mfa/setup')).toBe(true);
    for (const path of ['/mfa/', '/mfa/other', '/mfa-report', '/login', '/dashboard']) {
      expect(isMfaPath(path), path).toBe(false);
    }
  });
  it('認証系の画面（未ログインで開ける・ログイン中は /dashboard へ送る）には入れない', () => {
    // 入れると、ログイン中の人が /dashboard へ送り返されてコードを入力できず、未ログインの人が素通りする
    expect(isAuthPath('/mfa')).toBe(false);
    expect(isAuthPath('/mfa/setup')).toBe(false);
    expect(isPublicSharePath('/mfa')).toBe(false);
    expect(isPublicAuthApiPath('/mfa')).toBe(false);
  });
});

describe('isPublicAssetPath / isHealthPath', () => {
  it('ログインなしで返すのは、決まった名前のロゴ・アイコンと死活確認だけ', () => {
    for (const path of ['/favicon.ico', '/icon.svg', '/apple-icon.png', '/logo.svg', '/logo-dark.svg', '/logo-mark.svg']) {
      expect(isPublicAssetPath(path), path).toBe(true);
    }
    expect(isHealthPath('/api/health')).toBe(true);
  });

  it('画像に見えるだけのパスは対象にしない（/invite/x.png のような形で、プロキシの確認を避けさせない）', () => {
    for (const path of ['/invite/x.png', '/api/documents/x.png', '/dashboard.svg', '/logo.svg/x', '/x/logo.svg', '/anything.jpg', '/api/health.png', '/api/health/x']) {
      expect(isPublicAssetPath(path), path).toBe(false);
      expect(isHealthPath(path), path).toBe(false);
    }
  });
});

describe('requiresSameOrigin', () => {
  const CSP = '/api/csp-report';

  it('状態を変えうるメソッドで /api/ を呼ぶものは、送り元の確認の対象', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
      expect(requiresSameOrigin(method, '/api/resources/stakeholders', CSP), method).toBe(true);
    }
    expect(requiresSameOrigin('POST', '/api/auth/login', CSP)).toBe(true);
    expect(requiresSameOrigin('POST', '/api/activity', CSP)).toBe(true);
  });

  it('読み取り（GET・HEAD・OPTIONS）と、/api/ 以外（Server Action は Next.js が確かめる）は対象外', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
      expect(requiresSameOrigin(method, '/api/equity', CSP), method).toBe(false);
    }
    expect(requiresSameOrigin('POST', '/shareholders', CSP)).toBe(false);
  });

  it('CSP の違反報告だけは対象外（ブラウザが自動で送る）', () => {
    expect(requiresSameOrigin('POST', CSP, CSP)).toBe(false);
  });
});


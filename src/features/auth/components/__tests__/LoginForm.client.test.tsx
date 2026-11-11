// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { LoginForm } from '../LoginForm.client';

// App Router のフックと、ログインの API の呼び出し（loginClient）は画面外の依存なので差し替える。
const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  search: '',
  signInWithPassword: vi.fn(),
  setSessionPersistence: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: mocks.replace, refresh: mocks.refresh }),
  useSearchParams: () => new URLSearchParams(mocks.search),
}));
vi.mock('@/lib/supabase/client', () => ({
  setSessionPersistence: mocks.setSessionPersistence,
}));
vi.mock('@/features/auth/services/loginClient', () => ({
  signInWithPassword: mocks.signInWithPassword,
}));

const DEMO_HINT = 'ローカル確認用';
const SETUP_LINK = '初期セットアップ';

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('LoginForm', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllEnvs();
  });

  // デモアカウント（admin@example.com 等）はデモシード投入後にしか存在しない。
  // 未セットアップ環境（組織 0 件）で案内を出すと、ログインできないアカウントを勧めることになる。
  it('開発モードでも、未セットアップ環境ではデモアカウント案内を出さない', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { container, unmount } = render(<LoginForm showSetupLink />);

    expect(container.textContent).not.toContain(DEMO_HINT);
    expect(container.textContent).toContain(SETUP_LINK);
    unmount();
  });

  it('開発モードかつセットアップ済みならデモアカウント案内を出す', () => {
    vi.stubEnv('NODE_ENV', 'development');
    const { container, unmount } = render(<LoginForm showSetupLink={false} />);

    expect(container.textContent).toContain(DEMO_HINT);
    expect(container.textContent).not.toContain(SETUP_LINK);
    unmount();
  });

  it('本番ビルドではセットアップ状態によらずデモアカウント案内を出さない', () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { container, unmount } = render(<LoginForm showSetupLink={false} />);

    expect(container.textContent).not.toContain(DEMO_HINT);
    unmount();
  });
});

describe('LoginForm の送信（ログインはサーバの API 経由）', () => {
  let view: RenderResult | null = null;

  const submit = async (email: string, password: string) => {
    view = render(<LoginForm showSetupLink={false} />);
    setInputValue(view.container.querySelector<HTMLInputElement>('#login-email')!, email);
    setInputValue(view.container.querySelector<HTMLInputElement>('#login-password')!, password);
    await act(async () => {
      view!.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.search = '';
    mocks.signInWithPassword.mockResolvedValue({ ok: true, mfa: 'ok' });
  });

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('成功したら、保持の希望を記録してから API を呼び、/dashboard へ進む', async () => {
    await submit('member@example.com', 'short1');

    // パスワードの決まり（文字数など）はログインでは確かめない。入力のまま送る
    expect(mocks.signInWithPassword).toHaveBeenCalledWith('member@example.com', 'short1');
    expect(mocks.setSessionPersistence).toHaveBeenCalledWith(true);
    expect(mocks.setSessionPersistence.mock.invocationCallOrder[0]).toBeLessThan(mocks.signInWithPassword.mock.invocationCallOrder[0]);
    expect(mocks.replace).toHaveBeenCalledWith('/dashboard');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('next が安全な相対パスなら、そこへ進む', async () => {
    mocks.search = 'next=%2Fshareholders';
    await submit('member@example.com', 'pw');
    expect(mocks.replace).toHaveBeenCalledWith('/shareholders');
  });

  it('二要素認証のコードの確認が要る人は /mfa へ、登録が要る人は /mfa/setup へ進む（next を引き継ぐ）', async () => {
    mocks.signInWithPassword.mockResolvedValue({ ok: true, mfa: 'challenge' });
    await submit('member@example.com', 'pw');
    expect(mocks.replace).toHaveBeenLastCalledWith('/mfa');
    view?.unmount();

    mocks.search = 'next=%2Fcap-table';
    mocks.signInWithPassword.mockResolvedValue({ ok: true, mfa: 'enroll' });
    await submit('viewer@example.com', 'pw');
    expect(mocks.replace).toHaveBeenLastCalledWith('/mfa/setup?next=%2Fcap-table');
  });

  it('失敗したら、サーバが返した文言を出し、画面を移らない', async () => {
    mocks.signInWithPassword.mockResolvedValue({ ok: false, error: 'メールアドレスまたはパスワードが正しくありません。', code: 'invalid_credentials' });
    await submit('member@example.com', 'wrong');

    expect(view!.container.querySelector('p[role="alert"]')?.textContent).toBe('メールアドレスまたはパスワードが正しくありません。');
    expect(mocks.replace).not.toHaveBeenCalled();
    // もう一度送れる状態に戻っている
    expect(view!.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });
});

// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { MfaChallengeForm } from '../MfaChallengeForm.client';

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  verifyMfaChallenge: vi.fn(),
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock('@/features/auth/services/mfaChallenge', () => ({ verifyMfaChallenge: mocks.verifyMfaChallenge }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ auth: { signOut: mocks.signOut } }) }));

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('MfaChallengeForm', () => {
  let view: RenderResult | null = null;

  const submit = async (code: string) => {
    setInputValue(view!.container.querySelector<HTMLInputElement>('#mfa-code')!, code);
    await act(async () => {
      view!.container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    view = render(<MfaChallengeForm nextPath="/shareholders" email="member@example.com" />);
  });

  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('どのアカウントのコードを求めているかを示す', () => {
    expect(view!.container.textContent).toContain('member@example.com');
    expect(view!.container.querySelector<HTMLInputElement>('#mfa-code')!.autocomplete).toBe('one-time-code');
  });

  it('正しいコードなら、元の行き先へ進む', async () => {
    mocks.verifyMfaChallenge.mockResolvedValue({ ok: true, data: undefined });
    await submit('123456');
    expect(mocks.verifyMfaChallenge).toHaveBeenCalledWith({ code: '123456' });
    expect(mocks.replace).toHaveBeenCalledWith('/shareholders');
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it('コードが違えば、文言を出してその場に留まり、入力を空にする', async () => {
    mocks.verifyMfaChallenge.mockResolvedValue({ ok: false, error: 'コードが正しくありません。' });
    await submit('000000');
    expect(view!.container.querySelector('p[role="alert"]')?.textContent).toBe('コードが正しくありません。');
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(view!.container.querySelector<HTMLInputElement>('#mfa-code')!.value).toBe('');
  });

  it('通信に失敗しても、ボタンが固まらない', async () => {
    mocks.verifyMfaChallenge.mockRejectedValue(new Error('network'));
    await submit('123456');
    expect(view!.container.querySelector('p[role="alert"]')?.textContent).toContain('通信に失敗');
    setInputValue(view!.container.querySelector<HTMLInputElement>('#mfa-code')!, '123456');
    expect(view!.container.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
  });

  it('ログアウトできる（この端末のセッションだけを終えて、ログイン画面へ）', async () => {
    const signOutButton = [...view!.container.querySelectorAll('button')].find((button) => button.textContent?.includes('ログアウト'))!;
    click(signOutButton);
    await flush();
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mocks.replace).toHaveBeenCalledWith('/login');
  });
});

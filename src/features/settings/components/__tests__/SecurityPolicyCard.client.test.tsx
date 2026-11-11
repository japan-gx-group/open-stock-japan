// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { SecurityPolicyCard } from '../SecurityPolicyCard.client';

// 「セキュリティ」カード。設定の読み書き（Server Action）を差し替えて、出し分けと確認の流れを確かめる。
// 権限の正しさは Server Action（requireAdmin）が確かめる（mfaAdmin.test.ts）。
const mocks = vi.hoisted(() => ({
  getSecurityPolicy: vi.fn(),
  setRequireMfaForInternal: vi.fn(),
}));

vi.mock('@/features/settings/services/mfaAdmin', () => ({
  getSecurityPolicy: mocks.getSecurityPolicy,
  setRequireMfaForInternal: mocks.setRequireMfaForInternal,
}));

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const policy = (overrides: Record<string, unknown> = {}) => ({
  ok: true,
  data: { requireMfaForInternal: false, canEdit: true, viewerHasMfa: true, internalMfaCount: { enrolled: 1, total: 4 }, ...overrides },
});

describe('SecurityPolicyCard', () => {
  let view: RenderResult | null = null;
  const showToast = vi.fn();

  const mount = async () => {
    view = render(<SecurityPolicyCard showToast={showToast} />);
    await flush();
  };
  const button = (label: string, root: ParentNode = view!.container) =>
    [...root.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label) ?? null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSecurityPolicy.mockResolvedValue(policy());
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    document.body.innerHTML = '';
  });

  it('設定の文と、パスワード・ログインの失敗・セッションの決まりを出す', async () => {
    await mount();
    const text = view!.container.textContent ?? '';
    expect(text).toContain('社内のアカウント（管理者・メンバー・閲覧のみ');
    expect(text).toContain('に二要素認証を必須にする。');
    expect(text).toContain('12文字以上で、英字と数字をそれぞれ1文字以上含めてください');
    expect(text).toContain('15 分のあいだに 5 回失敗すると、15 分間ログインできなくなります');
    expect(text).toContain('ログインから 24 時間、または操作の無いまま 8 時間');
    expect(text).toContain('社内のアカウント 4 人のうち 1 人');
  });

  it('管理者以外には、変更のボタンを出さない', async () => {
    mocks.getSecurityPolicy.mockResolvedValue(policy({ canEdit: false, internalMfaCount: null }));
    await mount();
    expect(button('必須にする')).toBeNull();
    expect(button('必須をやめる')).toBeNull();
    expect(view!.container.textContent).toContain('この設定を変えられるのは管理者だけです。');
  });

  it('自分が未登録の管理者は、必須にできない（ボタンを無効にして、先に登録するよう案内する）', async () => {
    mocks.getSecurityPolicy.mockResolvedValue(policy({ viewerHasMfa: false }));
    await mount();
    expect(button('必須にする')!.disabled).toBe(true);
    expect(view!.container.textContent).toContain('必須にする前に、ご自身の二要素認証を登録してください');
    expect(view!.container.querySelector('a[href="/settings/account"]')).not.toBeNull();
  });

  it('必須にするときは、未登録の人数を示して確認してから保存する', async () => {
    mocks.setRequireMfaForInternal.mockResolvedValue({ ok: true, data: { requireMfaForInternal: true } });
    await mount();
    click(button('必須にする')!);

    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('まだ登録していない 3 人');
    expect(mocks.setRequireMfaForInternal).not.toHaveBeenCalled();

    click(button('必須にする', dialog)!);
    await flush();
    expect(mocks.setRequireMfaForInternal).toHaveBeenCalledWith(true);
    expect(showToast).toHaveBeenCalledWith('社内のアカウントの二要素認証を必須にしました', 'success');
    expect(view!.container.querySelector('.gt-pill')?.textContent).toBe('必須');
    expect(button('必須をやめる')).not.toBeNull();
  });

  it('保存をサーバが拒否したら、理由を確認の画面に出し、表示は変えない', async () => {
    mocks.setRequireMfaForInternal.mockResolvedValue({ ok: false, error: '管理者のみ操作できます' });
    await mount();
    click(button('必須にする')!);
    click(button('必須にする', document.querySelector('[role="dialog"]')!)!);
    await flush();
    expect(document.querySelector('[role="dialog"] p[role="alert"]')?.textContent).toBe('管理者のみ操作できます');
    expect(view!.container.querySelector('.gt-pill')?.textContent).toBe('任意');
    expect(showToast).not.toHaveBeenCalled();
  });

  it('必須のときは「必須をやめる」を出し、未登録の管理者でも押せる', async () => {
    mocks.getSecurityPolicy.mockResolvedValue(policy({ requireMfaForInternal: true, viewerHasMfa: false }));
    mocks.setRequireMfaForInternal.mockResolvedValue({ ok: true, data: { requireMfaForInternal: false } });
    await mount();
    expect(button('必須をやめる')!.disabled).toBe(false);
    click(button('必須をやめる')!);
    click(button('必須をやめる', document.querySelector('[role="dialog"]')!)!);
    await flush();
    expect(mocks.setRequireMfaForInternal).toHaveBeenCalledWith(false);
  });

  it('設定を取得できなければ、理由を出す', async () => {
    mocks.getSecurityPolicy.mockResolvedValue({ ok: false, error: 'セキュリティの設定を取得できませんでした' });
    await mount();
    expect(view!.container.querySelector('p[role="alert"]')?.textContent).toBe('セキュリティの設定を取得できませんでした');
    expect(button('必須にする')).toBeNull();
  });
});

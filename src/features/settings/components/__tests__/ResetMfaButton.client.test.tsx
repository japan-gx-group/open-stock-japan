// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { ResetMfaButton } from '../ResetMfaButton.client';

const mocks = vi.hoisted(() => ({ resetMemberMfa: vi.fn() }));

vi.mock('@/features/settings/services/mfaAdmin', () => ({ resetMemberMfa: mocks.resetMemberMfa }));

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('ResetMfaButton', () => {
  let view: RenderResult | null = null;
  const onReset = vi.fn();
  const showToast = vi.fn();

  const mount = (hasMfa: boolean) => {
    view = render(<ResetMfaButton memberId="member-1" memberName="管理 花子" hasMfa={hasMfa} onReset={onReset} showToast={showToast} />);
  };
  const button = (label: string, root: ParentNode) =>
    [...root.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label) ?? null;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    document.body.innerHTML = '';
  });

  it('二要素認証を登録していないメンバーには、何も出さない', () => {
    mount(false);
    expect(view!.container.innerHTML).toBe('');
  });

  it('押しただけではリセットしない。対象の名前を示して確認する', () => {
    mount(true);
    click(button('二要素認証をリセット', view!.container)!);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('管理 花子 さんの二要素認証をリセットします');
    expect(dialog.textContent).toContain('監査ログに残ります');
    expect(mocks.resetMemberMfa).not.toHaveBeenCalled();
  });

  it('確認するとリセットし、呼び出し元に知らせる', async () => {
    mocks.resetMemberMfa.mockResolvedValue({ ok: true, data: { removed: 1 } });
    mount(true);
    click(button('二要素認証をリセット', view!.container)!);
    click(button('リセットする', document.querySelector('[role="dialog"]')!)!);
    await flush();
    expect(mocks.resetMemberMfa).toHaveBeenCalledWith('member-1');
    expect(onReset).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('管理 花子 さんの二要素認証をリセットしました', 'success');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('サーバが拒否したら、理由を確認の画面に出す（呼び出し元には知らせない）', async () => {
    mocks.resetMemberMfa.mockResolvedValue({ ok: false, error: '自分の二要素認証は、アカウント設定から解除してください' });
    mount(true);
    click(button('二要素認証をリセット', view!.container)!);
    click(button('リセットする', document.querySelector('[role="dialog"]')!)!);
    await flush();
    expect(document.querySelector('[role="dialog"] p[role="alert"]')?.textContent).toBe('自分の二要素認証は、アカウント設定から解除してください');
    expect(onReset).not.toHaveBeenCalled();
  });

  it('キャンセルすれば何もしない', () => {
    mount(true);
    click(button('二要素認証をリセット', view!.container)!);
    click(button('キャンセル', document.querySelector('[role="dialog"]')!)!);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(mocks.resetMemberMfa).not.toHaveBeenCalled();
  });
});

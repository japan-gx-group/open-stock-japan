// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { MfaSettings } from '../MfaSettings.client';

// アカウント設定の「二要素認証」カード。登録・解除の Server Action を差し替えて、表示と手順を確かめる。
const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  getMfaOverview: vi.fn(),
  startMfaEnrollment: vi.fn(),
  confirmMfaEnrollment: vi.fn(),
  cancelMfaEnrollment: vi.fn(async () => ({ ok: true, data: undefined })),
  removeMfaFactor: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock('@/features/settings/services/mfa', () => ({
  getMfaOverview: mocks.getMfaOverview,
  startMfaEnrollment: mocks.startMfaEnrollment,
  confirmMfaEnrollment: mocks.confirmMfaEnrollment,
  cancelMfaEnrollment: mocks.cancelMfaEnrollment,
  removeMfaFactor: mocks.removeMfaFactor,
}));

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const overview = (factors: { id: string; name: string }[], required = false) => ({
  ok: true,
  data: { factors: factors.map((factor) => ({ ...factor, createdAt: '2026-11-11T04:00:00Z' })), required, maxFactors: 2 },
});

describe('MfaSettings', () => {
  let view: RenderResult | null = null;
  const showToast = vi.fn();

  const mount = async () => {
    view = render(<MfaSettings showToast={showToast} />);
    await flush();
  };
  const button = (label: string, root: ParentNode = view!.container) =>
    [...root.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label) ?? null;
  const submitForm = async (root: ParentNode) => {
    await act(async () => {
      root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    await flush();
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getMfaOverview.mockResolvedValue(overview([]));
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    document.body.innerHTML = '';
  });

  it('未設定のときは「設定する」を出し、リカバリーコードが無いことを案内する', async () => {
    await mount();
    expect(view!.container.textContent).toContain('未設定');
    expect(button('設定する')).not.toBeNull();
    expect(view!.container.textContent).toContain('リカバリーコード（予備のコード）はありません');
    expect(view!.container.textContent).toContain('管理者に二要素認証のリセットを依頼');
  });

  it('組織が必須にしていることを示す', async () => {
    mocks.getMfaOverview.mockResolvedValue(overview([], true));
    await mount();
    expect(view!.container.textContent).toContain('組織の設定で必須');
  });

  it('1 台のときは予備の機器を追加でき、2 台（上限）になると追加のボタンを出さない', async () => {
    mocks.getMfaOverview.mockResolvedValue(overview([{ id: 'f1', name: '仕事用' }]));
    await mount();
    expect(view!.container.textContent).toContain('設定済み（1台）');
    expect(button('予備の機器を追加')).not.toBeNull();
    view!.unmount();

    mocks.getMfaOverview.mockResolvedValue(overview([{ id: 'f1', name: '仕事用' }, { id: 'f2', name: '予備' }]));
    await mount();
    expect(view!.container.textContent).toContain('設定済み（2台）');
    expect(button('予備の機器を追加')).toBeNull();
    expect(button('設定する')).toBeNull();
  });

  it('登録: QR コードと秘密の値を見せ、コードを確認して完了する', async () => {
    mocks.startMfaEnrollment.mockResolvedValue({ ok: true, data: { factorId: 'pending-1', qrCode: 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E', secret: 'ABCDEFGHIJKLMNOP' } });
    mocks.confirmMfaEnrollment.mockResolvedValue({ ok: true, data: undefined });
    await mount();
    click(button('設定する')!);
    const dialog = () => document.querySelector('[role="dialog"]')!;
    click(button('QR コードを表示する', dialog())!);
    await flush();

    expect(mocks.startMfaEnrollment).toHaveBeenCalledWith({ name: '認証アプリ' });
    expect(dialog().querySelector('img')?.getAttribute('src')).toContain('data:image/svg+xml');
    // 手で入力しやすいよう 4 文字ずつに区切って見せる
    expect(dialog().querySelector('[data-testid="mfa-secret"]')?.textContent).toBe('ABCD EFGH IJKL MNOP');

    mocks.getMfaOverview.mockResolvedValue(overview([{ id: 'pending-1', name: '認証アプリ' }]));
    setInputValue(dialog().querySelector<HTMLInputElement>('#mfa-enroll-code')!, '123456');
    await submitForm(dialog());

    expect(mocks.confirmMfaEnrollment).toHaveBeenCalledWith({ factorId: 'pending-1', code: '123456' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(view!.container.textContent).toContain('設定済み（1台）');
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('二要素認証を登録しました'), 'success');
    expect(mocks.refresh).toHaveBeenCalled();
    // 完了した登録は取り消さない
    expect(mocks.cancelMfaEnrollment).not.toHaveBeenCalled();
  });

  it('登録の途中でやめたら、確認前の登録を消す', async () => {
    mocks.startMfaEnrollment.mockResolvedValue({ ok: true, data: { factorId: 'pending-1', qrCode: 'data:image/svg+xml,x', secret: 'ABCDEFGH' } });
    await mount();
    click(button('設定する')!);
    click(button('QR コードを表示する', document.querySelector('[role="dialog"]')!)!);
    await flush();
    click(button('やめる', document.querySelector('[role="dialog"]')!)!);
    await flush();
    expect(mocks.cancelMfaEnrollment).toHaveBeenCalledWith({ factorId: 'pending-1' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('登録のコードが違えば、文言を出して入力し直せる', async () => {
    mocks.startMfaEnrollment.mockResolvedValue({ ok: true, data: { factorId: 'pending-1', qrCode: 'data:image/svg+xml,x', secret: 'ABCDEFGH' } });
    mocks.confirmMfaEnrollment.mockResolvedValue({ ok: false, error: 'コードが正しくありません。' });
    await mount();
    click(button('設定する')!);
    const dialog = document.querySelector('[role="dialog"]')!;
    click(button('QR コードを表示する', dialog)!);
    await flush();
    setInputValue(dialog.querySelector<HTMLInputElement>('#mfa-enroll-code')!, '000000');
    await submitForm(dialog);
    expect(dialog.querySelector('p[role="alert"]')?.textContent).toBe('コードが正しくありません。');
    expect(dialog.querySelector<HTMLInputElement>('#mfa-enroll-code')!.value).toBe('');
  });

  it('解除: 現在のパスワードを入れて確認する。サーバが拒否したら理由を出す', async () => {
    mocks.getMfaOverview.mockResolvedValue(overview([{ id: 'f1', name: '仕事用' }]));
    mocks.removeMfaFactor.mockResolvedValueOnce({ ok: false, error: '現在のパスワードが正しくありません' }).mockResolvedValueOnce({ ok: true, data: undefined });
    await mount();
    click(button('解除する')!);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('「仕事用」を解除します');

    setInputValue(dialog.querySelector<HTMLInputElement>('#mfa-remove-password')!, 'wrong');
    await submitForm(dialog);
    expect(mocks.removeMfaFactor).toHaveBeenLastCalledWith({ factorId: 'f1', currentPassword: 'wrong' });
    expect(dialog.querySelector('p[role="alert"]')?.textContent).toBe('現在のパスワードが正しくありません');
    expect(showToast).not.toHaveBeenCalled();

    mocks.getMfaOverview.mockResolvedValue(overview([]));
    setInputValue(dialog.querySelector<HTMLInputElement>('#mfa-remove-password')!, 'current-pw');
    await submitForm(dialog);
    expect(showToast).toHaveBeenCalledWith('機器を解除しました', 'success');
    expect(view!.container.textContent).toContain('未設定');
    expect(mocks.refresh).toHaveBeenCalled();
  });
});

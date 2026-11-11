// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { sampleSnapshot } from '@/lib/equity/__tests__/fixture';
import { emptySnapshot, type EquitySnapshot } from '@/lib/equity/types';
import { CapTableView } from '../CapTableView.client';

// 資本政策表の画面が台帳から表を出すこと、シミュレーションが入力に応じて試算を出すこと、
// 登録の導線が編集できるロールにだけ出ることを確かめる。

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  snapshot: null as EquitySnapshot | null,
}));

vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ role: mocks.role, profile: null }) }));
vi.mock('@/hooks/useEquitySnapshot', () => ({
  useEquitySnapshot: () => ({ data: mocks.snapshot, error: null, isLoading: false, reload: async () => {} }),
}));
vi.mock('@/hooks/useCompany', () => ({
  useCompany: () => ({ data: { id: 'org', name: '株式会社サンプル' }, error: null, isLoading: false, reload: async () => {}, governance: {} }),
}));
vi.mock('@/features/ai/hooks/useAiStatus', () => ({ useAiStatus: () => ({ status: null, isLoading: false }) }));

beforeAll(() => {
  // recharts の ResponsiveContainer が使う。jsdom には無い
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const input = (view: RenderResult, id: string): HTMLInputElement => {
  const element = view.container.querySelector<HTMLInputElement>(`#${id}`);
  if (!element) throw new Error(`#${id} が見つかりません`);
  return element;
};

describe('CapTableView', () => {
  let view: RenderResult | null = null;
  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('台帳から表と合計、転換の内訳を出す', () => {
    mocks.role = 'viewer';
    mocks.snapshot = sampleSnapshot();
    view = render(<CapTableView />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('山田 太郎');
    expect(text).toContain('ストックオプション未割当枠');
    expect(text).toContain('転換型証券の転換の内訳（概算）');
    expect(text).toContain('契約書の定義が優先');
    expect(text).toContain('10,000株');
    expect(text).toContain('Excel に出力');
  });

  it('未割当の SO 枠を外すと、未割当枠の行が消える', () => {
    mocks.snapshot = sampleSnapshot();
    view = render(<CapTableView />);
    const checkbox = view.container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    act(() => checkbox?.click());
    expect(view.container.textContent).not.toContain('ストックオプション未割当枠');
  });

  it('プレマネーと調達額を入れると試算を出し、登録の導線は編集できるロールにだけ出す', () => {
    mocks.role = 'viewer';
    mocks.snapshot = sampleSnapshot();
    view = render(<CapTableView />);
    expect(view.container.textContent).toContain('プレマネー評価額を入れると試算します。');
    setInputValue(input(view, 'simulator-pre-money'), '5億');
    setInputValue(input(view, 'simulator-new-money'), '1億');
    const text = view.container.textContent ?? '';
    expect(text).toContain('= 5億円');
    expect(text).toContain('ポストマネー評価額');
    expect(text).toContain('新規投資家（次回調達）');
    expect(text).toContain('調達後の資本政策表（試算）');
    expect(text).not.toContain('このシナリオをラウンドとして登録');
    view.unmount();

    mocks.role = 'logger';
    view = render(<CapTableView />);
    setInputValue(input(view, 'simulator-pre-money'), '5億');
    expect(view.container.textContent).toContain('このシナリオをラウンドとして登録');
  });

  it('売却額を入れると優先分配の試算を出す', () => {
    mocks.snapshot = sampleSnapshot();
    view = render(<CapTableView />);
    setInputValue(input(view, 'waterfall-exit'), '10億');
    const text = view.container.textContent ?? '';
    expect(text).toContain('= 10億円');
    expect(text).toContain('1,000,000,000円');
    expect(text).toContain('定款・株主間契約');
  });

  it('記録が無いときは、株主名簿への案内を出す', () => {
    mocks.snapshot = emptySnapshot();
    view = render(<CapTableView />);
    expect(view.container.textContent).toContain('株式の記録がまだありません');
  });
});

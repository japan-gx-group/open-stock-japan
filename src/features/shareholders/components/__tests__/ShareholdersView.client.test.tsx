// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { COMMON, sampleSnapshot, transaction } from '@/lib/equity/__tests__/fixture';
import type { EquitySnapshot } from '@/lib/equity/types';
import { ShareholdersView } from '../ShareholdersView.client';

// 株主名簿の 3 つのタブの表示と、編集の操作が編集できるロールにだけ出ることを確かめる。

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  snapshot: null as EquitySnapshot | null,
  hasBoard: true,
}));

vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ role: mocks.role, profile: null }) }));
vi.mock('@/hooks/useEquitySnapshot', () => ({
  useEquitySnapshot: () => ({ data: mocks.snapshot, error: null, isLoading: false, reload: async () => {} }),
}));
vi.mock('@/hooks/useCompany', () => ({
  useCompany: () => ({
    data: { id: 'org', name: '株式会社サンプル', authorizedShares: 5_000, hasTransferRestriction: true },
    error: null,
    isLoading: false,
    reload: async () => {},
    governance: { hasBoardOfDirectors: mocks.hasBoard },
  }),
}));
vi.mock('@/features/ai/hooks/useAiStatus', () => ({ useAiStatus: () => ({ status: null, isLoading: false }) }));

const withTransfer = (): EquitySnapshot => {
  const snapshot = sampleSnapshot();
  snapshot.shareTransactions.push(
    transaction('yamada', COMMON, '2025-06-01', -500, { transactionType: 'transfer', groupId: 'group-1' }),
    transaction('sato', COMMON, '2025-06-01', 500, { transactionType: 'transfer', groupId: 'group-1' }),
  );
  return snapshot;
};

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.includes(text)) ?? null;

describe('ShareholdersView', () => {
  let view: RenderResult | null = null;
  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('株主名簿に 121 条の記載事項と、台帳の注意を出す', () => {
    mocks.role = 'viewer';
    mocks.snapshot = sampleSnapshot();
    view = render(<ShareholdersView />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('氏名又は名称');
    expect(text).toContain('株式を取得した日');
    expect(text).toContain('山田 太郎');
    expect(text).toContain('2024年4月1日');
    expect(text).toContain('会社法121条');
    expect(text).toContain('会社法125条');
    // 発行済 10,000 株 > 発行可能 5,000 株
    expect(text).toContain('発行可能株式総数（5,000株）を超えています');
  });

  it('権利者の一覧: 閲覧のみには登録・編集・削除を出さず、拡張用の「ポータル」列は渡されたときだけ出す', () => {
    mocks.role = 'viewer';
    mocks.snapshot = sampleSnapshot();
    view = render(<ShareholdersView initialTab="stakeholders" />);
    expect(view.container.textContent).toContain('青空1号投資事業有限責任組合');
    expect(view.container.textContent).toContain('3,000万円');
    expect(buttonByText(view.container, '権利者を登録')).toBeNull();
    expect(view.container.querySelector('button[title="削除"]')).toBeNull();
    expect(view.container.textContent).not.toContain('ポータル');
    view.unmount();

    mocks.role = 'logger';
    view = render(<ShareholdersView initialTab="stakeholders" renderStakeholderActions={(stakeholder) => <span>招待:{stakeholder.id}</span>} />);
    expect(buttonByText(view.container, '権利者を登録')).not.toBeNull();
    expect(view.container.querySelectorAll('button[title="削除"]')).toHaveLength(5);
    expect(view.container.textContent).toContain('ポータル');
    expect(view.container.textContent).toContain('招待:yamada');

    setInputValue(view.container.querySelector<HTMLInputElement>('#stakeholder-search')!, 'ファンド');
    expect(view.container.querySelectorAll('tbody tr')).toHaveLength(1);
  });

  it('株式の異動: まとめて記録した行は削除だけを出し、減少は赤字にする', () => {
    mocks.role = 'admin';
    mocks.snapshot = withTransfer();
    view = render(<ShareholdersView initialTab="transactions" />);
    const rows = Array.from(view.container.querySelectorAll('tbody tr'));
    expect(rows).toHaveLength(4);
    expect(rows[0].querySelector('button[title="編集"]')).not.toBeNull();
    expect(rows[2].textContent).toContain('一括記録');
    expect(rows[2].querySelector('button[title="編集"]')).toBeNull();
    expect(rows[2].querySelector('button[title^="削除"]')).not.toBeNull();
    // 株式数のセルは、数（減少は赤字）の下に株式の種類を添える
    expect(rows[2].querySelector('td.gt-num .text-danger')?.textContent).toBe('-500');

    click(rows[2].querySelector('button[title^="削除"]')!);
    expect(document.body.textContent).toContain('2 行すべて');
  });

  it('株式譲渡のダイアログ: 承認機関の案内と、譲渡人の持株を出す', () => {
    mocks.role = 'admin';
    mocks.hasBoard = false;
    mocks.snapshot = withTransfer();
    view = render(<ShareholdersView initialTab="transactions" />);
    click(buttonByText(view.container, '株式譲渡を記録')!);
    expect(document.body.textContent).toContain('会社法136条〜139条');
    expect(document.body.textContent).toContain('株主総会');
    const from = document.querySelector<HTMLSelectElement>('#transfer-from')!;
    // 譲渡人の候補は株式を持つ株主だけ
    expect(Array.from(from.options).map((option) => option.value)).toEqual(['', 'yamada', 'sato']);
    mocks.hasBoard = true;
  });

  it('閲覧のみには異動の登録・譲渡・分割の操作を出さない', () => {
    mocks.role = 'viewer';
    mocks.snapshot = withTransfer();
    view = render(<ShareholdersView initialTab="transactions" />);
    expect(buttonByText(view.container, '異動を登録')).toBeNull();
    expect(buttonByText(view.container, '株式譲渡を記録')).toBeNull();
    expect(buttonByText(view.container, '株式分割・併合を記録')).toBeNull();
    expect(view.container.querySelector('button[title^="削除"]')).toBeNull();
  });
});

// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { SERIES_A, sampleSnapshot, shareClass, transaction } from '@/lib/equity/__tests__/fixture';
import type { EquitySnapshot } from '@/lib/equity/types';
import { RoundsView } from '../RoundsView.client';

// ラウンドの一覧（払込額・登記の状況・割当て）と株式の種類の一覧、ロールによる出し分けを確かめる。

const mocks = vi.hoisted(() => ({ role: 'admin' as string, snapshot: null as EquitySnapshot | null }));

vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ role: mocks.role, profile: null }) }));
vi.mock('@/hooks/useEquitySnapshot', () => ({
  useEquitySnapshot: () => ({ data: mocks.snapshot, error: null, isLoading: false, reload: async () => {} }),
}));
vi.mock('@/features/ai/hooks/useAiStatus', () => ({ useAiStatus: () => ({ status: null, isLoading: false }) }));

const snapshotWithRound = (): EquitySnapshot => {
  const snapshot = sampleSnapshot();
  snapshot.shareClasses.push(shareClass(SERIES_A, 'A種優先株式', { kind: 'preferred', originalIssuePrice: 1_500, seniority: 1, sortOrder: 1, authorizedShares: 200_000 }));
  snapshot.fundingRounds.push({
    id: 'round-a',
    name: 'シリーズA',
    roundType: 'series_a',
    status: 'closed',
    shareClassId: SERIES_A,
    closingDate: '2020-01-10',
    pricePerShare: 1_500,
    preMoneyValuation: 1_650_000_000,
    targetAmount: 150_000_000,
    resolutionDate: null,
    registrationDate: null,
    capitalIncreaseAmount: null,
    notes: '',
  });
  snapshot.shareTransactions.push(
    transaction('aozora', SERIES_A, '2020-01-10', 100_000, { transactionType: 'new_issue', roundId: 'round-a', pricePerShare: 1_500, amount: 150_000_000 }),
  );
  return snapshot;
};

const buttonByText = (root: ParentNode, text: string): HTMLButtonElement | null =>
  Array.from(root.querySelectorAll('button')).find((button) => button.textContent?.includes(text)) ?? null;

describe('RoundsView', () => {
  let view: RenderResult | null = null;
  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('ラウンドの払込額・ポストマネー・登記の期限超過・資本金と登録免許税の目安を出す', () => {
    mocks.role = 'admin';
    mocks.snapshot = snapshotWithRound();
    view = render(<RoundsView />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('シリーズA');
    expect(text).toContain('1億5,000万円');
    expect(text).toContain('18億円');
    expect(text).toContain('登記の期限超過');
    expect(text).toContain('2020年1月24日');
    expect(text).toContain('7,500万円');
    expect(text).toContain('525,000円');
    expect(text).toContain('青空1号投資事業有限責任組合');
    expect(buttonByText(view.container, 'ラウンドを登録')).not.toBeNull();
    expect(buttonByText(view.container, '割当てを追加')).not.toBeNull();
  });

  it('閲覧のみには登録・編集・削除を出さない', () => {
    mocks.role = 'viewer';
    mocks.snapshot = snapshotWithRound();
    view = render(<RoundsView />);
    expect(buttonByText(view.container, 'ラウンドを登録')).toBeNull();
    expect(buttonByText(view.container, '割当てを追加')).toBeNull();
    expect(view.container.querySelector('button[title="編集"]')).toBeNull();
    expect(view.container.querySelector('button[title="削除"]')).toBeNull();
  });

  it('株式の種類のタブに、主な条件と発行済 ／ 発行可能を出す', () => {
    mocks.role = 'viewer';
    mocks.snapshot = snapshotWithRound();
    view = render(<RoundsView />);
    click(view.container.querySelector('#rounds-tab-classes')!);
    const text = view.container.textContent ?? '';
    expect(text).toContain('A種優先株式');
    expect(text).toContain('1 倍・非参加型');
    expect(text).toContain('100,000 ／ 200,000');
    expect(text).toContain('10,000 ／ 未設定');
    expect(buttonByText(view.container, '株式の種類を登録')).toBeNull();
  });
});

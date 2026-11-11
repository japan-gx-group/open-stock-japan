// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { sampleSnapshot } from '@/lib/equity/__tests__/fixture';
import { emptySnapshot, type EquitySnapshot } from '@/lib/equity/types';
import type { ComplianceTask } from '@/lib/legal/calendar';
import { DashboardView } from '../DashboardView.client';

// ダッシュボードが台帳の概要・近い期限の手続き・台帳の注意を出し、記録が無いときは登録の順番を案内することを確かめる。

const mocks = vi.hoisted(() => ({
  role: 'admin' as string,
  snapshot: null as EquitySnapshot | null,
  tasks: [] as ComplianceTask[],
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/hooks/useCurrentUser', () => ({ useCurrentUser: () => ({ role: mocks.role, profile: { organizationName: '株式会社サンプル' } }) }));
vi.mock('@/hooks/useEquitySnapshot', () => ({
  useEquitySnapshot: () => ({ data: mocks.snapshot, error: null, isLoading: false, reload: async () => {} }),
}));
vi.mock('@/hooks/useCompany', () => ({
  useCompany: () => ({ data: { id: 'org', name: '株式会社サンプル', authorizedShares: 100_000 }, error: null, isLoading: false, reload: async () => {}, governance: {} }),
}));
vi.mock('@/hooks/useComplianceTasks', () => ({
  useComplianceTasks: () => ({ tasks: mocks.tasks, isLoading: false, error: null, reload: async () => {} }),
}));

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const task = (key: string, dueOn: string, status: ComplianceTask['status'], daysLeft: number): ComplianceTask => ({
  key,
  category: 'registration',
  tracking: 'ledger',
  completedOn: null,
  completionNote: '',
  title: `手続き ${key}`,
  dueOn,
  status,
  daysLeft,
  description: '',
  basis: '会社法915条1項',
  href: '/rounds',
});

describe('DashboardView', () => {
  let view: RenderResult | null = null;
  afterEach(() => {
    view?.unmount();
    view = null;
  });

  it('株式の概要と、期限の近い手続きを 6 件まで出す', () => {
    mocks.snapshot = sampleSnapshot();
    mocks.tasks = [
      task('a', '2026-10-01', 'overdue', -41),
      ...Array.from({ length: 7 }, (_, index) => task(`u${index}`, `2026-12-0${index + 1}`, 'upcoming', 20 + index)),
      task('done', '2026-09-01', 'done', -71),
    ];
    view = render(<DashboardView />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('発行済株式総数');
    expect(text).toContain('10,000株');
    expect(text).toContain('発行可能株式総数 100,000株');
    expect(text).toContain('株主数');
    expect(text).toContain('3,000万円');
    expect(text).toContain('期限超過');
    expect(text).toContain('41 日超過');
    expect(text).not.toContain('手続き done');
    expect(view.container.querySelectorAll('tbody a[href="/rounds"]')).toHaveLength(6);
    expect(view.container.querySelector('a[href="/compliance"]')?.textContent).toContain('すべて見る');
    expect(text).not.toContain('はじめに登録すること');
  });

  it('台帳の注意（住所の未入力など）を出す', () => {
    const snapshot = sampleSnapshot();
    snapshot.stakeholders[0].address = '';
    mocks.snapshot = snapshot;
    mocks.tasks = [];
    view = render(<DashboardView />);
    expect(view.container.textContent).toContain('山田 太郎 の住所が未入力です');
    expect(view.container.textContent).toContain('期限の近い手続きはありません。');
  });

  it('記録が無いときは、会社情報 → 株主 → 株式の異動の順に案内する', () => {
    mocks.snapshot = emptySnapshot();
    mocks.tasks = [];
    view = render(<DashboardView />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('はじめに登録すること');
    const order = ['会社情報を登録する', '株主を登録する', '株式の異動を登録する'].map((title) => text.indexOf(title));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).not.toContain('完全希釈化後株式数');
  });
});

// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import type { AuditLogFilters } from '../../services/filters';
import type { AuditLogDetail, AuditLogItem } from '../../types';
import { AuditLogList } from '../AuditLogList.client';

// 一覧が、操作・対象・操作した人を日本語で出すこと、絞り込み・続きの読み込み・詳細の表示が API を正しく呼ぶことを確かめる。

const item = (seq: number, extra: Partial<AuditLogItem> = {}): AuditLogItem => ({
  id: `00000000-0000-0000-0000-${String(seq).padStart(12, '0')}`,
  seq,
  createdAt: '2026-11-11T04:03:35.590201+00:00',
  source: 'db',
  outcome: 'success',
  action: 'stakeholders.update',
  entityName: 'stakeholders',
  entityId: '50000000-0000-0000-0000-000000000007',
  entityLabel: '営業 花子',
  userId: 'aaaaaaaa-0000-0000-0000-000000000002',
  actorName: '管理 花子',
  actorEmail: 'member@example.com',
  actorRole: 'logger',
  ipAddress: '203.0.113.9',
  requestId: 'req-1',
  changedColumns: ['notes'],
  ...extra,
});

const FIRST_PAGE = [
  item(21),
  item(20, { source: 'auth', action: 'auth.login', entityName: 'auth.sessions', entityLabel: null, changedColumns: [], requestId: null }),
  item(19, { source: 'app', action: 'access.denied', outcome: 'denied', entityName: 'access', entityId: null, entityLabel: null, changedColumns: [] }),
  item(18, { action: 'brand_new.thing', source: 'app', userId: null, actorName: null, actorEmail: null, actorRole: null, ipAddress: null, changedColumns: [] }),
];

const DETAIL: AuditLogDetail = {
  ...item(21),
  detail: null,
  userAgent: 'Mozilla/5.0 Test',
  prevHash: 'c'.repeat(64),
  hash: 'f'.repeat(64),
  oldValues: { notes: '前のメモ', kind: 'individual' },
  newValues: { notes: '後のメモ', kind: 'corporation' },
};

const ACCOUNTS = {
  accounts: [
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', email: 'member@example.com', fullName: '管理 花子', role: 'logger', stakeholderId: null, stakeholderName: null, createdAt: '', lastSignInAt: null, mfaFactorCount: 0, bannedUntil: null, status: 'active' },
  ],
  invites: [],
  generatedAt: '2026-11-11T04:00:00.000Z',
};

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const setSelectValue = (select: HTMLSelectElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')?.set;
  act(() => {
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
};

describe('AuditLogList', () => {
  let view: RenderResult | null = null;
  const fetchMock = vi.fn();
  const changes: AuditLogFilters[] = [];

  const Harness = ({ initial = {} }: { initial?: AuditLogFilters }) => {
    const [filters, setFilters] = useState<AuditLogFilters>(initial);
    return (
      <AuditLogList
        filters={filters}
        onFiltersChange={(next) => {
          changes.push(next);
          setFilters(next);
        }}
      />
    );
  };

  const logCalls = (): string[] => fetchMock.mock.calls.map((call) => String(call[0])).filter((url) => url.startsWith('/api/audit/logs'));

  beforeEach(() => {
    changes.length = 0;
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/audit/accounts') return new Response(JSON.stringify(ACCOUNTS), { status: 200 });
      if (url === `/api/audit/logs/${DETAIL.id}`) return new Response(JSON.stringify({ item: DETAIL }), { status: 200 });
      if (url.startsWith('/api/audit/logs?')) {
        const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
        if (params.get('cursor') === '18') {
          return new Response(JSON.stringify({ items: [item(17, { entityLabel: '次のページの人' })], nextCursor: null }), { status: 200 });
        }
        if (params.get('q') === '該当なし') return new Response(JSON.stringify({ items: [], nextCursor: null, total: 0 }), { status: 200 });
        if (params.get('from') === '2026-12-31') return new Response(JSON.stringify({ error: '期間の始まりは、終わりより前の日付にしてください' }), { status: 400 });
        return new Response(JSON.stringify({ items: FIRST_PAGE, nextCursor: '18', total: 5 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    vi.unstubAllGlobals();
  });

  const rows = (): HTMLTableRowElement[] => Array.from(view?.container.querySelectorAll<HTMLTableRowElement>('tbody tr') ?? []);
  const button = (name: string): HTMLButtonElement | undefined =>
    Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.trim() === name);

  it('日時は日本時間、操作・対象・ロール・結果は日本語で出す', async () => {
    view = render(<Harness />);
    await flush();
    const text = rows().map((row) => row.textContent ?? '');
    expect(text).toHaveLength(4);
    expect(text[0]).toContain('2026/11/11 13:03:35');
    expect(text[0]).toContain('連番 21');
    expect(text[0]).toContain('管理 花子');
    expect(text[0]).toContain('member@example.com・メンバー');
    expect(text[0]).toContain('株主・権利者を更新（データ）');
    expect(text[0]).toContain('データの変更');
    expect(text[0]).toContain('株主・権利者「営業 花子」');
    expect(text[0]).toContain('変更した項目: メモ');
    expect(text[0]).toContain('成功');
    expect(text[0]).toContain('203.0.113.9');
    expect(text[1]).toContain('ログイン');
    expect(text[2]).toContain('権限のない操作（拒否）');
    expect(rows()[2].querySelector('.gt-pill-warn')?.textContent).toBe('拒否');
    expect(view.container.textContent).toContain('5 件中 4 件を表示');
  });

  it('操作した人が決まらない記録は「システム」、知らない操作は元の文字のまま出す', async () => {
    view = render(<Harness />);
    await flush();
    const text = rows()[3].textContent ?? '';
    expect(text).toContain('システム');
    expect(text).toContain('brand_new.thing');
  });

  it('表は横スクロールの枠で包み、文章の列だけ折り返しを許す（表の決まり）', async () => {
    view = render(<Harness />);
    await flush();
    const table = view.container.querySelector('table.gt-table');
    expect(table?.parentElement?.classList.contains('gt-table-scroll')).toBe(true);
    const cells = Array.from(rows()[0].children);
    expect(cells.map((cell) => cell.classList.contains('gt-wrap') || cell.classList.contains('gt-wrap-sm'))).toEqual([false, false, true, true, false, false]);
  });

  it('記録元を選ぶと、その条件で読み直す', async () => {
    view = render(<Harness />);
    await flush();
    setSelectValue(view.container.querySelector<HTMLSelectElement>('#audit-filter-source')!, 'db');
    await flush();
    expect(changes).toEqual([{ source: 'db' }]);
    expect(logCalls().at(-1)).toBe('/api/audit/logs?source=db');
  });

  it('キーワードは「検索」を押したときに反映する（打っている途中では読み直さない）', async () => {
    view = render(<Harness />);
    await flush();
    const before = logCalls().length;
    setInputValue(view.container.querySelector<HTMLInputElement>('#audit-filter-keyword')!, ' 該当なし ');
    await flush();
    expect(logCalls()).toHaveLength(before);
    click(button('検索')!);
    await flush();
    expect(changes).toEqual([{ q: '該当なし' }]);
    expect(logCalls().at(-1)).toBe(`/api/audit/logs?q=${encodeURIComponent('該当なし')}`);
    expect(view.container.textContent).toContain('条件に合う記録がありません。');
    // 条件をクリアすると、入力欄も空に戻る
    click(button('条件をクリア')!);
    await flush();
    expect(view.container.querySelector<HTMLInputElement>('#audit-filter-keyword')!.value).toBe('');
    expect(rows()).toHaveLength(4);
  });

  it('「さらに読み込む」は、続きの位置（cursor）を付けて読み、下に足す', async () => {
    view = render(<Harness />);
    await flush();
    click(button('さらに読み込む')!);
    await flush();
    expect(logCalls().at(-1)).toBe('/api/audit/logs?cursor=18');
    expect(rows()).toHaveLength(5);
    expect(rows()[4].textContent).toContain('次のページの人');
    expect(view.container.textContent).toContain('5 件');
    expect(button('さらに読み込む')).toBeUndefined();
  });

  it('API が条件を受け付けなかったときは、その理由を出し、前の条件の結果は出さない', async () => {
    view = render(<Harness />);
    await flush();
    const from = view.container.querySelector<HTMLInputElement>('input[aria-label="期間の始まり"]')!;
    setInputValue(from, '2026-12-31');
    // type="date" の入力は change で反映される
    act(() => {
      from.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flush();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain('期間の始まりは、終わりより前の日付にしてください');
    expect(view.container.textContent).not.toContain('営業 花子');
  });

  it('行を押すと詳細を開き、変更前後の値を項目の日本語名つきで出す', async () => {
    view = render(<Harness />);
    await flush();
    click(rows()[0]);
    await flush();
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(logCalls()).toContain(`/api/audit/logs/${DETAIL.id}`);
    const text = dialog?.textContent ?? '';
    expect(text).toContain('stakeholders.update');
    expect(text).toContain('当時のロール: メンバー');
    expect(text).toContain('Mozilla/5.0 Test');
    expect(text).toContain('f'.repeat(64));
    expect(text).toContain('c'.repeat(64));
    const diffRows = Array.from(dialog?.querySelectorAll('table tbody tr') ?? []).map((row) => Array.from(row.children).map((cell) => cell.textContent));
    expect(diffRows).toEqual([
      ['区分', '個人（individual）', '法人（corporation）'],
      ['メモ', '前のメモ', '後のメモ'],
    ]);
    expect(Array.from(dialog?.querySelectorAll('table thead th') ?? []).map((cell) => cell.textContent)).toEqual(['項目', '変更前', '変更後']);
  });

  it('詳細の「同じリクエストの記録を見る」は、リクエストの番号だけの条件に差し替えて読み直す', async () => {
    view = render(<Harness initial={{ source: 'db' }} />);
    await flush();
    click(rows()[0].querySelector('button')!);
    await flush();
    click(button('同じリクエストの記録を見る')!);
    await flush();
    expect(changes.at(-1)).toEqual({ requestId: 'req-1' });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(logCalls().at(-1)).toBe('/api/audit/logs?requestId=req-1');
    expect(view.container.textContent).toContain('同じリクエストの記録: req-1');
  });
});

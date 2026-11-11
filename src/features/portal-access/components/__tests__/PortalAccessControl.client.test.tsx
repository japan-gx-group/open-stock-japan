// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, type RenderResult } from '@/lib/testing/render';
import { resetPortalAccessCache } from '../../hooks/usePortalAccess';
import { PortalAccessControl } from '../PortalAccessControl.client';

// 状況の一覧を 1 回だけ読むこと、管理者にだけ操作を出すことを確かめる。

const mocks = vi.hoisted(() => ({ role: 'admin' as string }));

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({ role: mocks.role, profile: { id: 'u1', role: mocks.role } }),
}));

const ITEMS = {
  s1: { status: 'none' },
  s2: { status: 'invited', invitedAt: '2026-11-08T00:00:00Z', expiresAt: '2026-11-15T00:00:00Z', isExpired: false, inviteUrl: 'https://example.com/invite/abc' },
  s3: { status: 'active' },
  s4: { status: 'invited', expiresAt: '2026-11-01T00:00:00Z', isExpired: true },
};

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

const buttons = (root: Element): string[] => Array.from(root.querySelectorAll('button')).map((button) => button.textContent?.trim() ?? '');

describe('PortalAccessControl', () => {
  let view: RenderResult | null = null;
  const fetchMock = vi.fn();

  beforeEach(() => {
    resetPortalAccessCache();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === '/api/portal-access' && (!init?.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: ITEMS }), { status: 200 });
      }
      if (url === '/api/portal-access/invite') {
        return new Response(
          JSON.stringify({ inviteUrl: 'https://example.com/invite/new', email: 'a@example.com', expiresAt: '2026-11-18T00:00:00Z', emailStatus: 'skipped' }),
          { status: 201 },
        );
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

  const renderAll = () =>
    render(
      <div>
        <div data-row="s1"><PortalAccessControl stakeholderId="s1" stakeholderName="一郎" email="a@example.com" /></div>
        <div data-row="s2"><PortalAccessControl stakeholderId="s2" stakeholderName="二郎" email="b@example.com" /></div>
        <div data-row="s3"><PortalAccessControl stakeholderId="s3" stakeholderName="三郎" email="c@example.com" /></div>
        <div data-row="s4"><PortalAccessControl stakeholderId="s4" stakeholderName="四郎" email="d@example.com" /></div>
        <div data-row="s5"><PortalAccessControl stakeholderId="s1" stakeholderName="メールなし" email={null} /></div>
      </div>,
    );

  const row = (id: string): Element => view!.container.querySelector(`[data-row="${id}"]`)!;

  it('行がいくつあっても、状況の取得は 1 回だけ', async () => {
    mocks.role = 'admin';
    view = renderAll();
    await flush();
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/portal-access')).toHaveLength(1);
  });

  it('管理者には状況と、状況に応じた操作を出す', async () => {
    mocks.role = 'admin';
    view = renderAll();
    await flush();
    expect(row('s1').textContent).toContain('未招待');
    expect(buttons(row('s1'))).toEqual(['招待']);
    expect(row('s2').textContent).toContain('招待済み');
    // 表の列を広げないよう、招待リンクのコピーは短いラベルにしている（全文は title と aria-label）
    expect(buttons(row('s2'))).toEqual(['再招待', 'コピー', '取り消し']);
    expect(row('s2').querySelector('button[aria-label="招待リンクをコピー"]')?.getAttribute('title')).toBe('招待リンクをコピー');
    expect(row('s3').textContent).toContain('利用中');
    expect(buttons(row('s3'))).toEqual(['取り消し']);
    expect(row('s4').textContent).toContain('期限切れ');
    expect(row('s4').querySelector('.gt-pill')?.getAttribute('title')).toContain('招待の期限切れ');
    expect(buttons(row('s4'))).toEqual(['再招待', '取り消し']);
  });

  it('メールアドレスが無い株主は招待できない', async () => {
    mocks.role = 'admin';
    view = renderAll();
    await flush();
    const invite = row('s5').querySelector('button') as HTMLButtonElement;
    expect(invite.disabled).toBe(true);
    expect(invite.title).toContain('メールアドレスが未登録');
  });

  it('管理者以外には状況だけを出し、操作も招待リンクも出さない', async () => {
    for (const role of ['logger', 'viewer']) {
      mocks.role = role;
      view = renderAll();
      await flush();
      expect(row('s2').textContent).toContain('招待済み');
      expect(view.container.querySelectorAll('button')).toHaveLength(0);
      expect(view.container.innerHTML).not.toContain('example.com/invite');
      view.unmount();
      view = null;
    }
  });

  it('招待すると API を呼び、リンクを表示して、状況を読み直す', async () => {
    mocks.role = 'admin';
    view = renderAll();
    await flush();
    await act(async () => {
      (row('s1').querySelector('button') as HTMLButtonElement).click();
    });
    await flush();
    const inviteCall = fetchMock.mock.calls.find(([url]) => url === '/api/portal-access/invite');
    expect(inviteCall?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ stakeholderId: 's1' }) });
    expect((document.querySelector('input[aria-label="招待リンク"]') as HTMLInputElement | null)?.value).toBe('https://example.com/invite/new');
    expect(document.body.textContent).toContain('メール送信が設定されていない');
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/portal-access')).toHaveLength(2);
  });
});

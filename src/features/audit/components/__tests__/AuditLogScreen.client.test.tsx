// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, type RenderResult } from '@/lib/testing/render';
import { AuditLogScreen } from '../AuditLogScreen.client';

// 読めない人には理由だけを出して API を呼ばないこと、読める人には 3 つのタブを出すことを確かめる。

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('AuditLogScreen', () => {
  let view: RenderResult | null = null;
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/audit/accounts') {
        return new Response(
          JSON.stringify({
            accounts: [
              { id: 'u1', email: 'admin@example.com', fullName: '創業 太郎', role: 'admin', stakeholderId: null, stakeholderName: null, createdAt: '2026-01-05T01:00:00+00:00', lastSignInAt: null, mfaFactorCount: 0, bannedUntil: null, status: 'never' },
              { id: 'u2', email: 'holder@example.com', fullName: '投資 四郎', role: 'shareholder', stakeholderId: 's1', stakeholderName: '架空1号投資事業有限責任組合', createdAt: '2026-02-01T00:00:00+00:00', lastSignInAt: '2026-02-02T00:00:00+00:00', mfaFactorCount: 1, bannedUntil: null, status: 'dormant' },
            ],
            invites: [
              { email: 'new@example.com', role: 'viewer', stakeholderId: null, stakeholderName: null, invitedByUserId: 'u1', invitedByName: '創業 太郎', createdAt: '2026-11-01T00:00:00+00:00', expiresAt: '2026-11-08T00:00:00+00:00', isExpired: true },
            ],
            generatedAt: '2026-11-11T04:00:00.000Z',
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ items: [], nextCursor: null, total: 0 }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    vi.unstubAllGlobals();
  });

  it('読めない人には、サーバが返した理由だけを出す（タブも出さず、API も呼ばない）', async () => {
    view = render(<AuditLogScreen deniedMessage="監査ログは、管理者と監査人だけが見られます" />);
    await flush();
    expect(view.container.querySelector('h1')?.textContent).toBe('監査ログ');
    expect(view.container.textContent).toContain('監査ログは、管理者と監査人だけが見られます');
    expect(view.container.querySelectorAll('[role="tab"]')).toHaveLength(0);
    expect(view.container.querySelector('table')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('読める人には 3 つのタブを出し、最初は操作の記録', async () => {
    view = render(<AuditLogScreen deniedMessage={null} />);
    await flush();
    const tabs = Array.from(view.container.querySelectorAll('[role="tab"]'));
    expect(tabs.map((tab) => tab.textContent)).toEqual(['操作の記録', 'アカウントの棚卸し', '改ざんの検査']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(view.container.textContent).toContain('記録はまだありません。');
  });

  it('アカウントの棚卸し: アカウント（紐づく株主・二要素認証・状態）と、受け取られていない招待を出す', async () => {
    view = render(<AuditLogScreen deniedMessage={null} />);
    await flush();
    click(view.container.querySelectorAll('[role="tab"]')[1]);
    await flush();
    const tables = Array.from(view.container.querySelectorAll('table'));
    expect(tables).toHaveLength(2);
    expect(Array.from(tables[0].querySelectorAll('thead th')).map((cell) => cell.textContent)).toEqual([
      '氏名',
      'メールアドレス',
      'ロール',
      '作成日',
      '最後のログイン',
      '二要素認証',
      '状態',
    ]);
    const accounts = Array.from(tables[0].querySelectorAll('tbody tr')).map((row) => row.textContent ?? '');
    expect(accounts[0]).toContain('創業 太郎');
    expect(accounts[0]).toContain('管理者');
    expect(accounts[0]).toContain('2026/01/05');
    expect(accounts[0]).toContain('未登録');
    expect(accounts[0]).toContain('未ログイン');
    expect(accounts[1]).toContain('紐づく株主: 架空1号投資事業有限責任組合');
    expect(accounts[1]).toContain('株主');
    expect(accounts[1]).toContain('登録済み');
    expect(accounts[1]).toContain('長期間ログインなし');
    const invites = Array.from(tables[1].querySelectorAll('tbody tr')).map((row) => row.textContent ?? '');
    expect(invites[0]).toContain('new@example.com');
    expect(invites[0]).toContain('閲覧のみ');
    expect(invites[0]).toContain('創業 太郎');
    expect(invites[0]).toContain('期限切れ');
    expect(view.container.textContent).toContain('棚卸しの進め方');
  });
});

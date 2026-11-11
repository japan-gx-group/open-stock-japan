// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, render, setInputValue, type RenderResult } from '@/lib/testing/render';
import { ChainVerifyPanel } from '../ChainVerifyPanel.client';

// 改ざんの検査の結果を、問題なし・問題あり・控えと合わない、のそれぞれで取り違えずに出すことを確かめる。

const HASH = 'a70fedd434b628ccd890625286c4360bb07ff5ffd6aeef6b141e62e11ddd7fa0';
const OK_RESULT = { ok: true, count: 1234, lastSeq: 1234, lastHash: HASH, legacyCount: 6, checkedAt: '2026-11-11T04:25:24.5+00:00' };

const flush = async () => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

describe('ChainVerifyPanel', () => {
  let view: RenderResult | null = null;
  const fetchMock = vi.fn();
  const writeText = vi.fn(async () => undefined);
  let response: { status: number; body: unknown } = { status: 200, body: { result: OK_RESULT, anchor: null } };

  beforeEach(() => {
    fetchMock.mockReset();
    writeText.mockClear();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(response.body), { status: response.status }));
    vi.stubGlobal('fetch', fetchMock);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  });

  afterEach(() => {
    view?.unmount();
    view = null;
    vi.unstubAllGlobals();
  });

  const button = (name: string): HTMLButtonElement | undefined =>
    Array.from(view?.container.querySelectorAll('button') ?? []).find((element) => element.textContent?.trim() === name);
  const result = (): Element | null => view?.container.querySelector('[aria-label="検査の結果"]') ?? null;

  it('検査の前は、分かること・分からないこと（末尾を消された場合）と、控えの取り方を説明する', () => {
    view = render(<ChainVerifyPanel />);
    const text = view.container.textContent ?? '';
    expect(text).toContain('追記専用');
    expect(text).toContain('末尾の記録をまとめて消された場合');
    expect(text).toContain('別の場所に控えて');
    expect(result()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('問題なし: 件数・最新の連番・最新のハッシュを出し、連番とハッシュをコピーできる', async () => {
    response = { status: 200, body: { result: OK_RESULT, anchor: null } };
    view = render(<ChainVerifyPanel />);
    click(button('検査する')!);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/audit/verify', expect.objectContaining({ method: 'POST', body: JSON.stringify({ anchorSeq: '', anchorHash: '' }) }));
    expect(result()?.getAttribute('role')).toBe('status');
    const text = result()?.textContent ?? '';
    expect(text).toContain('書き換え・抜き取りは見つかりませんでした');
    expect(text).toContain('1,234 件');
    expect(text).toContain('この仕組みを入れる前の記録が 6 件');
    expect(text).toContain(HASH);
    expect(text).toContain('2026/11/11 13:25:24');
    expect(text).toContain('このシステムの外に控えて');

    click(button('連番とハッシュをコピー')!);
    await flush();
    expect(writeText).toHaveBeenCalledWith(`連番 1234 / ハッシュ ${HASH}`);
    expect(result()?.textContent).toContain('コピーしました');
  });

  it.each([
    ['gap', '連番が飛んでいます'],
    ['prev_hash_mismatch', '直前の記録のハッシュとつながりません'],
    ['hash_mismatch', '記録の内容とハッシュが合いません'],
  ])('問題あり（%s）: 止まった連番と理由を日本語で出し、「問題なし」とは出さない', async (reason, message) => {
    response = { status: 200, body: { result: { ok: false, reason, seq: 57, count: 57, ...(reason === 'gap' ? { expectedSeq: 56 } : {}) }, anchor: null } };
    view = render(<ChainVerifyPanel />);
    click(button('検査する')!);
    await flush();
    expect(result()?.getAttribute('role')).toBe('alert');
    const text = result()?.textContent ?? '';
    expect(text).toContain('記録に問題が見つかりました');
    expect(text).toContain('57');
    expect(text).toContain(message);
    expect(text.includes('本来の連番')).toBe(reason === 'gap');
    expect(text).not.toContain('見つかりませんでした');
    expect(button('連番とハッシュをコピー')).toBeUndefined();
  });

  it('控えを入れると一緒に送り、合っていればその旨を出す', async () => {
    response = { status: 200, body: { result: OK_RESULT, anchor: { seq: 1200, found: true, matches: true } } };
    view = render(<ChainVerifyPanel />);
    setInputValue(view.container.querySelector<HTMLInputElement>('#audit-anchor-seq')!, ' 1200 ');
    setInputValue(view.container.querySelector<HTMLInputElement>('#audit-anchor-hash')!, HASH);
    click(button('検査する')!);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith('/api/audit/verify', expect.objectContaining({ body: JSON.stringify({ anchorSeq: '1200', anchorHash: HASH }) }));
    expect(result()?.getAttribute('role')).toBe('status');
    expect(result()?.textContent).toContain('連番 1,200 の記録は、控えたハッシュと同じです');
  });

  it.each([
    [{ seq: 1200, found: true, matches: false }, 'ハッシュが、控えと違います'],
    [{ seq: 1200, found: false, matches: false }, '連番 1,200 の記録がありません'],
  ])('連鎖の計算が合っていても、控えと合わなければ「問題なし」とは出さない', async (anchor, message) => {
    response = { status: 200, body: { result: OK_RESULT, anchor } };
    view = render(<ChainVerifyPanel />);
    click(button('検査する')!);
    await flush();
    expect(result()?.getAttribute('role')).toBe('alert');
    const text = result()?.textContent ?? '';
    expect(text).toContain('いまの記録は、控えと合いません');
    expect(text).toContain(message);
    expect(text).not.toContain('書き換え・抜き取りは見つかりませんでした');
  });

  it('検査できなかったときは、理由を出し、結果は出さない', async () => {
    response = { status: 403, body: { error: '監査ログは、管理者と監査人だけが見られます' } };
    view = render(<ChainVerifyPanel />);
    click(button('検査する')!);
    await flush();
    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe('監査ログは、管理者と監査人だけが見られます');
    expect(result()).toBeNull();
  });
});

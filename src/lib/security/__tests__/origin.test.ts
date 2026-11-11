import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSameOriginRequest, resolveExpectedHost } from '../origin';

const request = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

describe('isSameOriginRequest', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('Origin が Host と一致すれば通す', () => {
    expect(isSameOriginRequest(request({ origin: 'https://stock.example.com', host: 'stock.example.com' }))).toBe(true);
    expect(isSameOriginRequest(request({ origin: 'http://localhost:3100', host: 'localhost:3100' }))).toBe(true);
  });

  it('Origin が無い・別サイト・壊れている場合は通さない', () => {
    expect(isSameOriginRequest(request({ host: 'stock.example.com' }))).toBe(false);
    expect(isSameOriginRequest(request({ origin: 'https://evil.example.com', host: 'stock.example.com' }))).toBe(false);
    expect(isSameOriginRequest(request({ origin: 'null', host: 'stock.example.com' }))).toBe(false);
    // ポートが違えば別のオリジン
    expect(isSameOriginRequest(request({ origin: 'http://localhost:3000', host: 'localhost:3100' }))).toBe(false);
  });

  it('リバースプロキシ越し: x-forwarded-host（先頭）と比べる', () => {
    expect(
      isSameOriginRequest(
        request({ origin: 'https://stock.example.com', host: 'localhost:3000', 'x-forwarded-host': 'stock.example.com, internal' }),
      ),
    ).toBe(true);
  });

  it('APP_URL があればそのホストと比べ、Host 系ヘッダは見ない', () => {
    vi.stubEnv('APP_URL', 'https://stock.example.com/');
    expect(resolveExpectedHost(request({ host: 'evil.example.com' }))).toBe('stock.example.com');
    expect(isSameOriginRequest(request({ origin: 'https://stock.example.com', host: 'localhost:3000' }))).toBe(true);
    expect(
      isSameOriginRequest(request({ origin: 'https://evil.example.com', host: 'evil.example.com', 'x-forwarded-host': 'evil.example.com' })),
    ).toBe(false);
  });

  it('APP_URL があるときは、スキームとポートまで含めて比べる（https のサイトに、同じホストの http からの送信を通さない）', () => {
    vi.stubEnv('APP_URL', 'https://stock.example.com');
    expect(isSameOriginRequest(request({ origin: 'https://stock.example.com' }))).toBe(true);
    expect(isSameOriginRequest(request({ origin: 'http://stock.example.com' }))).toBe(false);
    expect(isSameOriginRequest(request({ origin: 'https://stock.example.com:8443' }))).toBe(false);
    expect(isSameOriginRequest(request({ origin: 'https://stock.example.com.evil.example' }))).toBe(false);
    expect(isSameOriginRequest(request({ origin: 'https://user@stock.example.com' }))).toBe(true);
    expect(isSameOriginRequest(request({ origin: 'null' }))).toBe(false);
  });

  it('APP_URL が不正な形式なら通さない（設定ミスを黙って緩めない）', () => {
    vi.stubEnv('APP_URL', 'not a url');
    expect(isSameOriginRequest(request({ origin: 'https://stock.example.com', host: 'stock.example.com' }))).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { clientIpFromHeaders, trustedProxyHops } from '../clientIp';

// 接続元の IP アドレスを、利用者が書き換えられない位置の値から決める。
// X-Forwarded-For は「利用者が書いた値, …, 手前のプロキシが足した値」の順に並ぶ。

const xff = (value: string) => new Headers({ 'x-forwarded-for': value });

describe('clientIpFromHeaders', () => {
  it('プロキシが 1 段（既定）なら、いちばん右の値を使う。利用者が先頭に書いた値は使わない', () => {
    expect(clientIpFromHeaders(xff('203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(clientIpFromHeaders(xff('1.2.3.4, 203.0.113.9'), 1)).toBe('203.0.113.9');
    expect(clientIpFromHeaders(xff('1.2.3.4,5.6.7.8 , 203.0.113.9'), 1)).toBe('203.0.113.9');
  });

  it('プロキシが 2 段なら、右から 2 番目の値を使う', () => {
    expect(clientIpFromHeaders(xff('1.2.3.4, 203.0.113.9, 10.0.0.1'), 2)).toBe('203.0.113.9');
  });

  it('段数より値が少ないときは、届いた中でいちばん外側（左）の値を使う', () => {
    expect(clientIpFromHeaders(xff('203.0.113.9'), 2)).toBe('203.0.113.9');
  });

  it('段数が 0（プロキシなし）なら、ヘッダを信じず null', () => {
    expect(clientIpFromHeaders(xff('203.0.113.9'), 0)).toBeNull();
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': '203.0.113.9' }), 0)).toBeNull();
  });

  it('X-Forwarded-For が無ければ x-real-ip、どちらも無ければ null', () => {
    expect(clientIpFromHeaders(new Headers({ 'x-real-ip': ' 203.0.113.9 ' }), 1)).toBe('203.0.113.9');
    expect(clientIpFromHeaders(new Headers(), 1)).toBeNull();
  });

  it('IPv6 を受け付け、IP アドレスの形でない値（文・記号）は使わない', () => {
    expect(clientIpFromHeaders(xff('2001:db8::1'), 1)).toBe('2001:db8::1');
    expect(clientIpFromHeaders(xff('::1'), 1)).toBe('::1');
    for (const value of ['unknown', '203.0.113.9; drop table', '<script>', 'a'.repeat(60)]) {
      expect(clientIpFromHeaders(xff(value), 1), value).toBeNull();
    }
  });
});

describe('trustedProxyHops', () => {
  it('未設定・不正な値は 1（プロキシ 1 段）として扱う', () => {
    for (const value of [undefined, '', ' ', 'abc', '-1', '1.5', '99']) {
      expect(trustedProxyHops(value), String(value)).toBe(1);
    }
  });

  it('0〜10 の整数はそのまま使う', () => {
    expect(trustedProxyHops('0')).toBe(0);
    expect(trustedProxyHops('2')).toBe(2);
    expect(trustedProxyHops(' 3 ')).toBe(3);
  });
});

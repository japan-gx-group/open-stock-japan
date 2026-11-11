// 利用者の IP アドレスを、リクエストのヘッダから決める（プロキシ・サーバ共通。node: のモジュールは使わない）。
//
// X-Forwarded-For は「利用者, プロキシ1, プロキシ2 …」と、経由したプロキシが右へ足していく。
// 左側は利用者が自由に書けるので、先頭の値を信じると、接続元を偽れる（監査ログの接続元・回数の制限の回避）。
// 信じてよいのは、自分たちのプロキシが足した右側の値だけ。
//
// TRUSTED_PROXY_HOPS（環境変数。既定は 1）に、アプリの前に置いている「信頼できるプロキシの段数」を入れる。
//   1 … プロキシが 1 段（Vercel、nginx 1 台など）。いちばん右の値を使う
//   2 … CDN + ロードバランサなど 2 段。右から 2 番目の値を使う
//   0 … プロキシを置かず、X-Forwarded-For を信じない（接続元は記録しない）
// アプリをプロキシなしで直接インターネットに公開すると、この値は利用者の申告になる（docs/system-audit.md）。

interface HeadersLike {
  get(name: string): string | null;
}

const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 10;

export const trustedProxyHops = (raw: string | undefined = process.env.TRUSTED_PROXY_HOPS): number => {
  if (raw == null || raw.trim() === '') return DEFAULT_TRUSTED_PROXY_HOPS;
  const hops = Number(raw.trim());
  return Number.isInteger(hops) && hops >= 0 && hops <= MAX_TRUSTED_PROXY_HOPS ? hops : DEFAULT_TRUSTED_PROXY_HOPS;
};

// IP アドレスに使える文字だけ（IPv4・IPv6・ポートなし）。それ以外を含む値は使わない
const IP_PATTERN = /^[0-9a-fA-F:.]{2,45}$/;

/** 信頼できるプロキシの段数ぶん右から数えた位置の値。決められなければ null */
export const clientIpFromHeaders = (headers: HeadersLike, hops: number = trustedProxyHops()): string | null => {
  if (hops <= 0) return null;
  const forwarded = (headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  // 段数より値が少ないとき（プロキシの手前で止まった・設定より段数が少ない）は、いちばん左（＝届いた中でいちばん外側）を使う
  const candidate = forwarded.length > 0 ? forwarded[Math.max(forwarded.length - hops, 0)] : (headers.get('x-real-ip') ?? '').trim();
  return IP_PATTERN.test(candidate) ? candidate : null;
};

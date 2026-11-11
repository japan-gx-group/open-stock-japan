// ログイン不要の共有リンク（/share/<token>）の、トークン照会の回数制限。
//
// トークンは 256 ビットの乱数なので総当たりは現実的でないが、未認証で DB の照会を駆動できる入口なので
// 送信元 IP ごとと全体の両方に上限を置く（x-forwarded-for は詐称できるため、IP 単位だけにしない）。
// プロセス内のカウンタ（src/lib/security/rateLimit.ts）。複数インスタンスでは「台数 × 上限」が実効値になる。

import { clientIpFromHeaders } from '@/lib/security/clientIp';
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';

export const SHARE_LOOKUP_WINDOW_SECONDS = 60;
export const SHARE_LOOKUP_LIMIT_PER_CLIENT = 30;
export const SHARE_LOOKUP_LIMIT_GLOBAL = 600;

const perClient = createFixedWindowRateLimiter({
  limit: SHARE_LOOKUP_LIMIT_PER_CLIENT,
  windowMs: SHARE_LOOKUP_WINDOW_SECONDS * 1000,
});
const overall = createFixedWindowRateLimiter({
  limit: SHARE_LOOKUP_LIMIT_GLOBAL,
  windowMs: SHARE_LOOKUP_WINDOW_SECONDS * 1000,
  maxKeys: 1,
});

// 接続元は、信頼できるプロキシが足した位置の値で決める（先頭の値は利用者が自由に書ける。src/lib/security/clientIp.ts）
export const clientKeyOf = (headers: { get(name: string): string | null }): string => clientIpFromHeaders(headers) ?? 'unknown';

/**
 * 照会してよければ true（1 回分を消費する）。
 * 先に接続元ごとの上限を見る。逆の順にすると、1 つの接続元が上限を超えて叩き続けるだけで全体の枠を使い切り、
 * ほかの人の共有リンクまで開けなくなる。
 */
export const consumeShareLookupQuota = (headers: { get(name: string): string | null }, now?: number): boolean =>
  perClient.consume(clientKeyOf(headers), now) && overall.consume('global', now);

/** テスト用 */
export const resetShareLookupQuota = (): void => {
  perClient.reset();
  overall.reset();
};

// 同じ接続元（IP アドレス）からのログインの失敗が多すぎるときに、その接続元からの試行をしばらく受け付けない。
//
// メールアドレスごとの一時停止（attemptLog.ts）だけでは、メールアドレスを次々に変えて試す相手を止められず、
// 追記専用の監査ログに失敗の行を際限なく書かせることにもなる。そこで接続元ごとにも上限を置く。
// 数えるのは失敗だけ（成功したログインは数えない）。プロセスの中のカウンタなので、複数台で動かすと
// 台数ぶん緩くなる。厳密な上限は、認証サービス側の回数制限と、前段（WAF・リバースプロキシ）に任せる。

export const IP_FAILURE_LIMIT = 30;
export const IP_FAILURE_WINDOW_MS = 5 * 60 * 1000;

interface Window {
  count: number;
  resetAt: number;
}

export interface FailureThrottle {
  /** この接続元からの試行を、いま止めているか。止めていれば解けるまでの秒数、止めていなければ null */
  retryAfterSeconds: (key: string, now?: number) => number | null;
  /** 失敗を 1 回数える */
  noteFailure: (key: string, now?: number) => void;
  /** テスト用 */
  reset: () => void;
}

export const createFailureThrottle = ({
  limit = IP_FAILURE_LIMIT,
  windowMs = IP_FAILURE_WINDOW_MS,
  maxKeys = 10_000,
}: { limit?: number; windowMs?: number; maxKeys?: number } = {}): FailureThrottle => {
  const windows = new Map<string, Window>();

  const current = (key: string, now: number): Window | null => {
    const window = windows.get(key);
    if (!window) return null;
    if (window.resetAt <= now) {
      windows.delete(key);
      return null;
    }
    return window;
  };

  return {
    retryAfterSeconds: (key, now = Date.now()) => {
      const window = current(key, now);
      if (!window || window.count < limit) return null;
      return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    },
    noteFailure: (key, now = Date.now()) => {
      const window = current(key, now);
      if (window) {
        window.count += 1;
        return;
      }
      // 接続元を偽って大量のキーを作られても、メモリが膨らまないようにする
      if (windows.size >= maxKeys) {
        windows.forEach((value, existingKey) => {
          if (value.resetAt <= now) windows.delete(existingKey);
        });
        if (windows.size >= maxKeys) windows.clear();
      }
      windows.set(key, { count: 1, resetAt: now + windowMs });
    },
    reset: () => windows.clear(),
  };
};

/** ログインの API が使う、プロセスで 1 つのカウンタ */
export const loginFailureThrottle = createFailureThrottle();

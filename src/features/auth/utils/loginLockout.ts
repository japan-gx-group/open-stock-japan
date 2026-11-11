// 失敗が続いたときの一時的な停止（ロック）の数え方（純粋な関数）。
// ログイン（メールアドレスごと）と、二要素認証のコードの確認（アカウントごと）で同じ数え方を使う。
//
// 決まり: 15 分のあいだに 5 回失敗すると、5 回目の失敗から 15 分間は受け付けない。
//   - 止めているあいだの試行は、認証サービスに問い合わせず、失敗としても数えない（止めた記録は 1 回だけ残す）。
//   - 15 分たつと解け、数え直す（止める前の失敗は、解けた時点ですべて 15 分より前になる）。
//   - 成功しても数え直さない（「15 分に 5 回まで」を、ほかの人の成功で緩めない）。
//
// 回数は監査ログ（system_audit_logs）の「失敗」の行から数える。サーバのプロセスの中で数えないので、
// 複数台で動かしても、再起動しても同じ結果になる（読み書きは src/features/auth/services/attemptLog.ts）。

export interface LockoutRule {
  /** この回数の失敗で止める */
  maxFailures: number;
  /** 失敗を数える時間の幅であり、止める時間の長さ（ミリ秒） */
  windowMs: number;
}

export const LOGIN_LOCKOUT_RULE: LockoutRule = { maxFailures: 5, windowMs: 15 * 60 * 1000 };

/** 二要素認証のコードの確認も、同じ決まりにする */
export const MFA_LOCKOUT_RULE: LockoutRule = LOGIN_LOCKOUT_RULE;

export interface LockoutStatus {
  locked: boolean;
  /** 止めているときの、解ける時刻（ミリ秒）。止めていなければ null */
  lockedUntil: number | null;
  /** いま数えている失敗の回数（止めているあいだは maxFailures） */
  failureCount: number;
}

/**
 * 失敗の時刻の一覧から、いま止めているかを決める。
 * failureTimes には、少なくとも「now から windowMs の 2 倍前」までの失敗を渡すこと
 * （いま効いているロックは直近の windowMs の中で始まり、その引き金の失敗はさらに windowMs 前まで遡るため）。
 */
export const evaluateLockout = (
  failureTimes: readonly number[],
  now: number,
  rule: LockoutRule = LOGIN_LOCKOUT_RULE,
): LockoutStatus => {
  // DB の時計とサーバの時計が少しずれていて「未来の失敗」に見えるものは、いまの失敗として数える
  const sorted = failureTimes.map((time) => Math.min(time, now)).sort((a, b) => a - b);

  let lockedUntil = Number.NEGATIVE_INFINITY;
  let counted: number[] = [];
  for (const time of sorted) {
    // 止めているあいだに（同時の要求などで）残った失敗は数えない。ロックを延ばさない
    if (time < lockedUntil) continue;
    counted = counted.filter((earlier) => earlier > time - rule.windowMs);
    counted.push(time);
    if (counted.length >= rule.maxFailures) {
      lockedUntil = time + rule.windowMs;
      counted = [];
    }
  }

  if (now < lockedUntil) {
    return { locked: true, lockedUntil, failureCount: rule.maxFailures };
  }
  return {
    locked: false,
    lockedUntil: null,
    failureCount: counted.filter((time) => time > now - rule.windowMs).length,
  };
};

/** 解けるまでの残り（分。切り上げ、最小 1） */
export const remainingLockMinutes = (lockedUntil: number, now: number): number =>
  Math.max(1, Math.ceil((lockedUntil - now) / 60_000));

export const lockoutWindowMinutes = (rule: LockoutRule = LOGIN_LOCKOUT_RULE): number =>
  Math.round(rule.windowMs / 60_000);

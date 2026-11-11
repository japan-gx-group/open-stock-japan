// 認証済みの重い API に共通する、レート制限・リクエスト不正のエラー型と窓幅の定数。
// 追加ライブラリは使わない。回数の数え方は機能ごとに持つ（例: AI は src/lib/ai/rateLimit.ts が
// 監査ログの件数を数える）。Route Handler はここのエラーを 429 / 4xx に変換して返す。

// 「1分あたりN件」の窓。この制限は時間で必ず解けるため、Retry-After は窓幅そのものでよい。
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;
export const RATE_LIMIT_RETRY_AFTER_SECONDS = RATE_LIMIT_WINDOW_MS / 1000;

export class RateLimitExceededError extends Error {
  readonly retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'RateLimitExceededError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
  }
}

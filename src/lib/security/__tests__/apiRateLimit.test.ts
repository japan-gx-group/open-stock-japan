import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  RATE_LIMIT_RETRY_AFTER_SECONDS,
  RATE_LIMIT_WINDOW_MS,
  RateLimitExceededError,
} from '../apiRateLimit';

describe('apiRateLimit', () => {
  it('Retry-After の既定値は窓幅（1 分）と同じ', () => {
    expect(RATE_LIMIT_WINDOW_MS).toBe(60_000);
    expect(RATE_LIMIT_RETRY_AFTER_SECONDS).toBe(60);
  });

  it('RateLimitExceededError は再試行までの秒数を持つ', () => {
    const error = new RateLimitExceededError('回数の上限に達しました', 30);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('RateLimitExceededError');
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('ApiRequestError は HTTP ステータスを持つ', () => {
    const error = new ApiRequestError('入力が正しくありません', 400);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ApiRequestError');
    expect(error.status).toBe(400);
  });
});

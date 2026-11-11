import { describe, expect, it } from 'vitest';
import { IP_FAILURE_LIMIT, IP_FAILURE_WINDOW_MS, createFailureThrottle } from '../loginThrottle';

describe('createFailureThrottle', () => {
  it('上限までは止めない。上限に達したら、窓が終わるまで止める', () => {
    const throttle = createFailureThrottle({ limit: 3, windowMs: 60_000 });
    const start = 1_000_000;
    expect(throttle.retryAfterSeconds('ip', start)).toBeNull();
    throttle.noteFailure('ip', start);
    throttle.noteFailure('ip', start + 1_000);
    expect(throttle.retryAfterSeconds('ip', start + 2_000)).toBeNull();
    throttle.noteFailure('ip', start + 2_000);
    expect(throttle.retryAfterSeconds('ip', start + 3_000)).toBe(57);
    // 窓は最初の失敗から数える
    expect(throttle.retryAfterSeconds('ip', start + 59_999)).toBe(1);
    expect(throttle.retryAfterSeconds('ip', start + 60_000)).toBeNull();
  });

  it('接続元ごとに別々に数える', () => {
    const throttle = createFailureThrottle({ limit: 1, windowMs: 60_000 });
    throttle.noteFailure('a', 0);
    expect(throttle.retryAfterSeconds('a', 1)).not.toBeNull();
    expect(throttle.retryAfterSeconds('b', 1)).toBeNull();
  });

  it('窓が終われば数え直す', () => {
    const throttle = createFailureThrottle({ limit: 2, windowMs: 1_000 });
    throttle.noteFailure('ip', 0);
    throttle.noteFailure('ip', 10);
    expect(throttle.retryAfterSeconds('ip', 20)).not.toBeNull();
    throttle.noteFailure('ip', 2_000);
    expect(throttle.retryAfterSeconds('ip', 2_001)).toBeNull();
  });

  it('キーの数に上限があり、あふれても動き続ける（メモリを使い切らない）', () => {
    const throttle = createFailureThrottle({ limit: 1, windowMs: 60_000, maxKeys: 3 });
    for (const key of ['a', 'b', 'c', 'd']) throttle.noteFailure(key, 0);
    expect(throttle.retryAfterSeconds('d', 1)).not.toBeNull();
  });

  it('既定は、同じ接続元から 5 分に 30 回の失敗まで', () => {
    expect(IP_FAILURE_LIMIT).toBe(30);
    expect(IP_FAILURE_WINDOW_MS).toBe(5 * 60 * 1000);
  });
});

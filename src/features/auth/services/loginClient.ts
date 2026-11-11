// ブラウザからログインの API（POST /api/auth/login）を呼ぶ。ログイン・招待の受諾・初期セットアップの 3 画面で使う。
// 応答の文言はサーバが日本語で返す。通信そのものが失敗したときだけ、ここで文言を決める。

import { LOGIN_ERROR_MESSAGES } from '@/features/auth/services/loginErrorMessage';
import type { MfaState } from '@/features/auth/utils/mfaState';

export type SignInResult = { ok: true; mfa: MfaState } | { ok: false; error: string; code?: string };

const isMfaState = (value: unknown): value is MfaState => value === 'ok' || value === 'challenge' || value === 'enroll';

export const signInWithPassword = async (email: string, password: string): Promise<SignInResult> => {
  let response: Response;
  try {
    response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ email, password }),
    });
  } catch {
    return { ok: false, error: LOGIN_ERROR_MESSAGES.network };
  }

  const body = (await response.json().catch(() => null)) as { ok?: unknown; error?: unknown; code?: unknown; mfa?: unknown } | null;
  if (response.ok && body?.ok === true) {
    return { ok: true, mfa: isMfaState(body.mfa) ? body.mfa : 'ok' };
  }
  return {
    ok: false,
    error: typeof body?.error === 'string' && body.error ? body.error : LOGIN_ERROR_MESSAGES.unknown,
    code: typeof body?.code === 'string' ? body.code : undefined,
  };
};

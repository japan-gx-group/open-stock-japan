// 二要素認証（TOTP）について、いまのセッションがどの状態かを決める（純粋な関数。ブラウザ・サーバ・テストで共通）。
//
//   ok        … そのまま使ってよい
//   challenge … 確認済みの要素を持っているのに、セッションがまだパスワードだけ（aal1）。コードの入力が要る
//   enroll    … 組織が社内のアカウントに必須にしているのに、まだ要素を登録していない。登録が要る
//
// サーバ（src/lib/sessionState.ts）は、認証サービスが確かめたトークンの aal と、認証サービスから取り直した
// 要素の一覧でこの関数を呼ぶ。DB 側の同じ判定は current_session_mfa_ok()
// （supabase/migrations/20261111000006_auth_policy.sql）。片方だけを変えないこと。

import { isInternal, type MemberRole } from '@/types/role';

export type MfaState = 'ok' | 'challenge' | 'enroll';

export type AssuranceLevel = 'aal1' | 'aal2';

/** 認証サービスが返す要素（user.factors）のうち、ここで使う項目 */
export interface MfaFactorLike {
  id: string;
  status: string;
  factor_type?: string;
  friendly_name?: string | null;
  created_at?: string;
}

/** 確認済み（登録が済んで、ログインのたびにコードを求める）要素だけを取り出す */
export const verifiedFactors = <T extends MfaFactorLike>(factors: readonly T[] | null | undefined): T[] =>
  (factors ?? []).filter((factor) => factor.status === 'verified');

export interface MfaStateInput {
  /** 確認済みの要素の数 */
  verifiedFactorCount: number;
  /** セッションの保証レベル（確かめたトークンの aal）。読めなければ null（aal1 と同じ扱い） */
  aal: AssuranceLevel | null;
  /** プロフィールのロール。プロフィールが無ければ null */
  role: MemberRole | null;
  /** 組織の設定: 社内のアカウントに二要素認証を必須にする */
  requireMfaForInternal: boolean;
}

export const decideMfaState = ({ verifiedFactorCount, aal, role, requireMfaForInternal }: MfaStateInput): MfaState => {
  // 要素を登録した人は、ロールや組織の設定にかかわらず、コードを確認するまで使えない
  if (verifiedFactorCount > 0) {
    return aal === 'aal2' ? 'ok' : 'challenge';
  }
  // 要素が無い人: 組織が必須にしていて、社内のロール（isInternal）なら、先に登録させる。
  // 株主ロールは対象外（本人が任意で登録できる）
  if (requireMfaForInternal && isInternal(role)) {
    return 'enroll';
  }
  return 'ok';
};

const decodeBase64Url = (value: string): string => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

/**
 * アクセストークン（JWT）の本体から aal を読む。署名は確かめない。
 * 必ず、認証サービスが確かめたトークン（auth.getUser(token) が通ったもの）に対して呼ぶこと。
 * 確かめていないトークンの内容は、ブラウザが自由に書き換えられる。
 */
export const readAalFromAccessToken = (accessToken: string | null | undefined): AssuranceLevel | null => {
  if (!accessToken) return null;
  const parts = accessToken.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(parts[1])) as { aal?: unknown };
    return payload.aal === 'aal1' || payload.aal === 'aal2' ? payload.aal : null;
  } catch {
    return null;
  }
};

/** 二要素認証の画面（/mfa・/mfa/setup）へ送るときの URL。元の行き先を next で引き継ぐ */
export const mfaRedirectUrl = (state: Exclude<MfaState, 'ok'>, nextPath?: string | null): string => {
  const base = state === 'challenge' ? '/mfa' : '/mfa/setup';
  return nextPath ? `${base}?next=${encodeURIComponent(nextPath)}` : base;
};

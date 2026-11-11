// 権限の要る操作の入口で、ログイン中の人のロールを確かめる（サーバ専用）。
//   requireAdmin    … 管理者だけ（組織の設定・メンバー管理）
//   requireEditor   … 管理者・メンバー（業務データの編集）
//   requireInternal … 社内の全員（管理者・メンバー・閲覧のみ・監査人）。株主ロールを通さない読み取りに使う
//   requireAuditReader … 管理者・監査人（監査ログとアカウントの棚卸しの閲覧）
//
// ロールは必ずこの関数でサーバ側から読む（getCurrentProfile がリクエストのたびに profiles を読む）。
// ブラウザから送られたロールは改ざんできるため使わない。service_role を使う処理は RLS が効かないので、
// 業務テーブル（authenticated に GRANT が無い）を読む・書く処理では、service_role のクライアントを作る前に
// 必ずどれかを通すこと。通したあとも、クエリは profile.organizationId で絞る。
//
// ⚠️ サーバ専用: cookies() を使う getCurrentProfile に依存するため Client Component から import しないこと。

import 'server-only';
import { recordAuditEvent } from '@/lib/audit/events';
import { readAuditRequestContext } from '@/lib/audit/requestContext';
import { getCurrentProfile, type CurrentProfile } from '@/lib/currentProfile';
import { createFixedWindowRateLimiter } from '@/lib/security/rateLimit';
import { canEdit, canReadAuditLog, isAdmin, isInternal } from '@/types/role';

export const SIGNED_OUT_MESSAGE = 'セッションが確認できません。ログインし直してください';
export const ADMIN_ONLY_MESSAGE = '管理者のみ操作できます';

export const EDITOR_ONLY_MESSAGE = '閲覧のみの権限では操作できません';
export const INTERNAL_ONLY_MESSAGE = 'この操作を行う権限がありません';
export const AUDIT_READER_ONLY_MESSAGE = '監査ログは、管理者と監査人だけが見られます';

export type AuthzCheck =
  | { ok: true; profile: CurrentProfile }
  | { ok: false; status: 401 | 403; error: string };

// 以前の名前。requireAdmin の戻り値として使っている箇所のために残す。
export type AdminCheck = AuthzCheck;

/** 権限の種類（監査ログの「権限エラー」に、何の権限が足りなかったかを残す） */
type Requirement = 'admin' | 'editor' | 'internal' | 'audit';

// 権限エラーの記録は、同じ人の同じ操作につき 1 分に 1 件まで（画面が同じ API を繰り返し呼んでも、監査ログを埋めない）。
// プロセス内のカウンタなので、複数台で動かすと台数ぶん残り得る。
const deniedLogLimiter = createFixedWindowRateLimiter({ limit: 1, windowMs: 60_000 });

// 権限の無い操作を試みたことを監査ログに残す。記録に失敗しても、拒否の応答は変えない
const recordDenied = async (profile: CurrentProfile, requirement: Requirement): Promise<void> => {
  const { route } = await readAuditRequestContext();
  if (!deniedLogLimiter.consume(`${profile.id}:${requirement}:${route ?? ''}`)) return;
  await recordAuditEvent(
    { organizationId: profile.organizationId, userId: profile.id },
    { action: 'access.denied', entityName: 'access', detail: { required: requirement, role: profile.role, route }, outcome: 'denied' },
  );
};

const requireRole = async (
  allows: (role: CurrentProfile['role']) => boolean,
  deniedMessage: string,
  requirement: Requirement,
): Promise<AuthzCheck> => {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { ok: false, status: 401, error: SIGNED_OUT_MESSAGE };
  }
  if (!allows(profile.role)) {
    await recordDenied(profile, requirement);
    return { ok: false, status: 403, error: deniedMessage };
  }
  return { ok: true, profile };
};

// Route Handler は status をそのまま返し、Server Action は error を ActionResult のエラーに使う。
export const requireAdmin = (): Promise<AuthzCheck> => requireRole(isAdmin, ADMIN_ONLY_MESSAGE, 'admin');

// 業務データを編集できる人（管理者・メンバー）だけを通す。閲覧のみ・監査人・株主は 403。
export const requireEditor = (): Promise<AuthzCheck> => requireRole(canEdit, EDITOR_ONLY_MESSAGE, 'editor');

// 社内の人（管理者・メンバー・閲覧のみ・監査人）だけを通す。株主は 403。
export const requireInternal = (): Promise<AuthzCheck> =>
  requireRole(isInternal, INTERNAL_ONLY_MESSAGE, 'internal');

// 監査ログとアカウントの棚卸しを読める人（管理者・監査人）だけを通す。
export const requireAuditReader = (): Promise<AuthzCheck> =>
  requireRole(canReadAuditLog, AUDIT_READER_ONLY_MESSAGE, 'audit');

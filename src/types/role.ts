// ロール（権限区分）は認証・設定・各画面の出し分けなど複数機能で共有する
// ドメイン値のため、全体共有の型としてここに置く。
// 値の正本は DB の check 制約（profiles_role_check / invites_role_check。
// supabase/migrations/20261111000005_auditor_role.sql で監査人を足した）。
//
// ロールは 5 つ。
//   admin       … 管理者。組織の設定（企業情報・事業年度・メンバーの招待・削除・ロールの変更）まで行える。監査ログも読める
//   logger      … 社内メンバー。業務データ（株主名簿・新株予約権・会議・文書など）を編集できる
//   viewer      … 社内の閲覧のみ。業務データを読めるが編集はできない
//   auditor     … 監査人。業務データと監査ログ・アカウントの棚卸しを読めるが、何も変えられない（職務の分離のためのロール）
//   shareholder … 社外の株主。株主ポータル（/external-portal）だけを使える。profiles.stakeholderId で権利者に紐づく
//
// 判定はこのファイルの isAdmin / isInternal / canEdit / canReadAuditLog / isShareholder で行い、ロールの文字列を
// 各所で直接比べない。権限の正しさはサーバ（src/lib/authz.ts の requireAdmin / requireEditor /
// requireInternal）と RLS（current_user_is_admin() / current_user_is_internal()）で確かめ、
// 画面は出し分けだけにする。

export const MEMBER_ROLES = ['admin', 'logger', 'viewer', 'auditor', 'shareholder'] as const;

export type MemberRole = (typeof MEMBER_ROLES)[number];

// 社内のロール（メンバー管理の画面が扱う範囲）。株主ロールは含めない。
export const INTERNAL_ROLES = ['admin', 'logger', 'viewer', 'auditor'] as const;

export type InternalRole = (typeof INTERNAL_ROLES)[number];

// メンバー管理の画面（招待・ロールの変更）で付けられる値。社内の 4 つのロールすべて。
// 'shareholder' はこの画面からは書かない（株主名簿の画面から、権利者に紐づけて招待する）。
// DB の change_member_role も同じ 4 つだけを受け付ける。
export const ASSIGNABLE_MEMBER_ROLES = ['admin', 'logger', 'viewer', 'auditor'] as const;

export type AssignableMemberRole = (typeof ASSIGNABLE_MEMBER_ROLES)[number];

export const ADMIN_ROLE: AssignableMemberRole = 'admin';
export const MEMBER_ROLE: AssignableMemberRole = 'logger';
export const SHAREHOLDER_ROLE: MemberRole = 'shareholder';

export const isMemberRole = (value: unknown): value is MemberRole =>
  typeof value === 'string' && (MEMBER_ROLES as readonly string[]).includes(value);

export const isAssignableMemberRole = (value: unknown): value is AssignableMemberRole =>
  typeof value === 'string' && (ASSIGNABLE_MEMBER_ROLES as readonly string[]).includes(value);

export const isAdmin = (role: MemberRole | null | undefined): boolean => role === 'admin';

// 社外の株主（株主ポータルだけを使える）か。
export const isShareholder = (role: MemberRole | null | undefined): boolean =>
  role === 'shareholder';

// 社内のメンバー（管理者・メンバー・閲覧のみ・監査人）か。株主ロールとロール不明は false。
export const isInternal = (role: MemberRole | null | undefined): role is InternalRole =>
  role === 'admin' || role === 'logger' || role === 'viewer' || role === 'auditor';

// 監査ログとアカウントの棚卸しを読めるか（管理者・監査人）。
export const canReadAuditLog = (role: MemberRole | null | undefined): boolean =>
  role === 'admin' || role === 'auditor';

// 業務データを編集できるか（管理者・メンバー）。閲覧のみ・株主・ロール不明は false。
export const canEdit = (role: MemberRole | null | undefined): boolean =>
  role === 'admin' || role === 'logger';

const ROLE_LABELS: Record<MemberRole, string> = {
  admin: '管理者',
  logger: 'メンバー',
  viewer: '閲覧のみ',
  auditor: '監査人',
  shareholder: '株主',
};

// ロールを選ぶ画面に添える説明。
const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  admin: 'すべての操作と、組織の設定・メンバーの管理ができます',
  logger: '株主名簿・会議・文書などのデータを編集できます',
  viewer: 'データを見ることだけができます',
  auditor: 'データと監査ログを見ることだけができます（何も変えられません）',
  shareholder: '株主ポータルだけを使えます',
};

export const memberRoleDescription = (role: MemberRole): string => ROLE_DESCRIPTIONS[role];

// 画面の表示名。
export const memberRoleLabel = (role: MemberRole): string => ROLE_LABELS[role];

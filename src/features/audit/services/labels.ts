// 監査ログの表示名（操作・種類・記録元・結果・検査の結果）。サーバ依存なしの純粋な関数。
//
// 操作（action）の値は 3 通りある。
//   - データの変更（source = 'db'）: 「テーブル名.insert | update | delete」。DB のトリガーが残す
//   - アプリの操作（source = 'app'）: 「リソース名.操作」や「機能.操作」。サーバのコードが残す
//   - 認証（source = 'auth'）: 「auth.操作」
// 操作はこれからも増えるので、知らない値は元の文字のまま返す（画面が壊れない・記録が隠れない）。

import { ACTIVITY_KINDS } from '@/lib/audit/activity';
import { COMPANY_DEF } from '@/lib/resources/company';
import { RESOURCES } from '@/lib/resources/definitions';
import { isMemberRole, memberRoleLabel } from '@/types/role';
import type { AuditLogItem } from '../types';

// ---- 記録元・結果 ----

const SOURCE_LABELS: Record<string, string> = {
  app: 'アプリの操作',
  db: 'データの変更',
  auth: '認証',
};

export const auditSourceLabel = (source: string): string => SOURCE_LABELS[source] ?? source;

const OUTCOME_LABELS: Record<string, string> = {
  success: '成功',
  failure: '失敗',
  denied: '拒否',
};

export const auditOutcomeLabel = (outcome: string): string => OUTCOME_LABELS[outcome] ?? outcome;

/** 結果のピルの色（globals.css の gt-pill-*） */
export const auditOutcomeTone = (outcome: string): string =>
  outcome === 'success' ? 'gt-pill-good' : outcome === 'failure' ? 'gt-pill-bad' : outcome === 'denied' ? 'gt-pill-warn' : 'gt-pill-neutral';

// ---- テーブル（対象の種類）の名前 ----

// リソース定義に無いテーブルと、テーブルではない対象の名前
const EXTRA_TABLE_LABELS: Record<string, string> = {
  profiles: 'アカウント',
  invites: '招待',
  documents: '文書',
  document_shares: '文書の公開先',
  share_links: '共有リンク',
  ai_settings: 'AI の設定',
  ai_credentials: 'AI の API キー',
  document_extractions: 'AI の読み取り結果',
  compliance_task_states: '手続きの完了の記録',
  system_audit_logs: '監査ログ',
  access: 'アクセス権限',
  export: 'データの出力',
  'auth.sessions': 'ログイン',
  'auth.users': 'アカウント',
};

const TABLE_LABELS: Record<string, string> = {
  ...Object.fromEntries(Object.values(RESOURCES).map((def) => [def.table, def.label])),
  [COMPANY_DEF.table]: COMPANY_DEF.label,
  ...EXTRA_TABLE_LABELS,
};

/** リソース名（share-transactions）もテーブル名（share_transactions）も同じ名前で引けるようにそろえる */
const toTableName = (name: string): string => name.replace(/-/g, '_');

/** テーブル名（またはリソース名）の日本語名。知らない名前は null */
export const findTableLabel = (name: string): string | null => {
  if (Object.hasOwn(TABLE_LABELS, name)) return TABLE_LABELS[name];
  const table = toTableName(name);
  return Object.hasOwn(TABLE_LABELS, table) ? TABLE_LABELS[table] : null;
};

/** テーブル名（またはリソース名）の日本語名。知らない名前はそのまま返す */
export const tableLabel = (name: string): string => findTableLabel(name) ?? name;

/** 名前を知っているテーブルの一覧（キーワードの検索で、表示名から操作を引くのに使う） */
export const knownTableNames = (): string[] => Object.keys(TABLE_LABELS).filter((name) => !name.includes('.'));

// ---- 操作の名前 ----

const DB_OPERATION_LABELS: Record<string, string> = {
  insert: '追加',
  update: '更新',
  delete: '削除',
};

// 「リソース名.操作」の形で残る、アプリの操作の動詞
const APP_VERB_LABELS: Record<string, string> = {
  create: '登録',
  update: '更新',
  delete: '削除',
};

// 個別に名前を決めている操作
const ACTION_LABELS: Record<string, string> = {
  // ブラウザの中で完結する出力・印刷（名前は src/lib/audit/activity.ts が正本）
  ...ACTIVITY_KINDS,
  // 認証
  'auth.login': 'ログイン',
  'auth.logout': 'ログアウト',
  'auth.login.failed': 'ログインの失敗',
  'auth.login.locked': 'ログインを一時停止（失敗が続いたため）',
  'auth.mfa.enroll': '二要素認証を登録',
  'auth.mfa.unenroll': '二要素認証を解除',
  'auth.mfa.reset': 'メンバーの二要素認証を解除（管理者）',
  'auth.mfa.verify.failed': '二要素認証のコードの誤り',
  'auth.mfa.locked': '二要素認証を一時停止（誤りが続いたため）',
  'auth.reauth.failed': '本人確認（パスワードの再入力）の失敗',
  'auth.reauth.locked': '本人確認を一時停止（失敗が続いたため）',
  'auth.password.change': 'パスワードを変更',
  'auth.password.reset': 'パスワードを再設定',
  'auth.user_signedup': 'アカウントを登録',
  'auth.user_invited': 'アカウントを招待',
  'auth.invite_accepted': '招待を受けて登録',
  'auth.user_modified': 'アカウントの情報を変更',
  'auth.user_updated_password': 'パスワードを変更',
  'auth.user_recovery_requested': 'パスワードの再設定を要求',
  'auth.user_reauthenticate_requested': '本人確認（再認証）を要求',
  'auth.user_confirmation_requested': 'メールアドレスの確認を要求',
  'auth.user_repeated_signup': '登録済みのメールアドレスで再登録',
  'auth.user_deleted': 'アカウントを削除',
  'auth.identity_unlinked': '外部アカウントとの連携を解除',
  'auth.factor_in_progress': '二要素認証の登録を開始',
  'auth.factor_updated': '二要素認証の設定を変更',
  'auth.factor_unenrolled': '二要素認証を解除',
  'auth.factor_deleted': '二要素認証を削除',
  'auth.challenge_created': '二要素認証の確認を開始',
  'auth.verification_attempted': '二要素認証のコードを確認',
  'auth.mfa_code_login': '二要素認証でログイン',
  'auth.generate_recovery_codes': '回復コードを発行',
  'auth.recovery_codes_deleted': '回復コードを削除',
  'access.denied': '権限のない操作（拒否）',
  // 株式
  'equity.transfer': '株式の譲渡を記録',
  'equity.split': '株式の分割を記録',
  'share-transactions.transfer': '株式の譲渡を記録',
  'share-transactions.split': '株式の分割を記録',
  // 会社情報・手続き
  'company.update': '会社情報を更新',
  'compliance.complete': '手続きを完了として記録',
  'compliance.reopen': '手続きの完了を取り消し',
  // 文書・共有
  'documents.create': '文書を登録',
  'documents.update': '文書を更新',
  'documents.delete': '文書を削除',
  'documents.download': '文書をダウンロード',
  'documents.sharing.update': '文書の公開先を変更',
  'share_links.create': '共有リンクを発行',
  'share_links.revoke': '共有リンクを無効化',
  'share_links.access': '共有リンクからのアクセス',
  'portal_access.invite': '株主をポータルに招待',
  'portal_access.revoke_account': '株主のアカウントを削除',
  'portal_access.revoke_invite': '株主の招待を取り消し',
  // 文書テンプレート（差し込み項目を台帳の値に置き換えて、文書を作った）
  'document-templates.compose': 'テンプレートから文書を作成',
  // メンバー・権限
  'invite.create': 'メンバーを招待',
  'invite.revoke': 'メンバーの招待を取り消し',
  'invite.accept': '招待を受けて登録',
  'member.role.update': 'メンバーのロールを変更',
  'member.remove': 'メンバーを削除',
  'account.delete': 'アカウントを削除（退会）',
  'organization.setup': '組織を初期登録',
  // AI・取り込み
  'ai.request': 'AI を利用',
  'ai.model.update': 'AI のモデルを変更',
  'ai.credential.update': 'AI の API キーを登録・更新',
  'ai.credential.delete': 'AI の API キーを削除',
  'ai.reauth.failed': 'AI の設定の本人確認に失敗',
  'credential.update': 'AI の API キーを登録・更新',
  'credential.delete': 'AI の API キーを削除',
  'import.extract': '文書を AI で読み取り',
  'import.apply': '読み取り結果を台帳に反映',
  'import.apply_failed': '読み取り結果の反映に失敗',
  'import.discard': '読み取り結果を破棄',
  // 監査
  'audit_log.view': '監査ログを閲覧',
  'audit_log.export': '監査ログを CSV で出力',
  'audit_log.verify': '監査ログの改ざんを検査',
  'access_review.export': 'アカウントの棚卸しを CSV で出力',
};

const splitAction = (action: string): { head: string; tail: string } | null => {
  const index = action.lastIndexOf('.');
  if (index <= 0 || index === action.length - 1) return null;
  return { head: action.slice(0, index), tail: action.slice(index + 1) };
};

/**
 * 操作の表示名。
 *   データの変更（source = 'db'）は「株式の異動を追加（データ）」のように、テーブルの名前から作る。
 *   知らないテーブルは「new_table を追加（データ）」、知らない操作は元の文字（例: 'foo.bar'）を返す。
 */
export const auditActionLabel = (action: string, source?: string): string => {
  const parts = splitAction(action);

  if (source === 'db') {
    const operation = parts ? DB_OPERATION_LABELS[parts.tail] : undefined;
    if (!parts || !operation) return action;
    const table = findTableLabel(parts.head);
    return table ? `${table}を${operation}（データ）` : `${parts.head} を${operation}（データ）`;
  }

  if (Object.hasOwn(ACTION_LABELS, action)) return ACTION_LABELS[action];
  if (!parts) return action;

  // 「リソース名.create | update | delete」
  const table = findTableLabel(parts.head);
  const verb = APP_VERB_LABELS[parts.tail];
  if (table && verb) return `${table}を${verb}`;

  // 名前を決めていないデータの出力（export.xxx）。何を出したかは元の文字で添える
  if (action.startsWith('export.')) return `データを出力（${action.slice('export.'.length)}）`;

  return action;
};

/** キーワードに合う表示名を持つ操作の一覧（「ログイン」と打って auth.login を探せるようにする） */
export const actionsMatchingLabel = (keyword: string, limit = 60): string[] => {
  const needle = keyword.trim().toLowerCase();
  if (!needle) return [];
  const candidates = new Map<string, string>();
  for (const [action, label] of Object.entries(ACTION_LABELS)) candidates.set(action, label);
  for (const table of knownTableNames()) {
    for (const [operation, label] of Object.entries(DB_OPERATION_LABELS)) {
      candidates.set(`${table}.${operation}`, `${tableLabel(table)}を${label}（データ）`);
    }
  }
  for (const def of [...Object.values(RESOURCES), COMPANY_DEF]) {
    for (const [verb, label] of Object.entries(APP_VERB_LABELS)) {
      const action = `${def.name}.${verb}`;
      // テーブル名とリソース名が同じとき（stakeholders.update など）は、両方の表示名で引けるようにつなげる
      candidates.set(action, `${candidates.get(action) ?? ''} ${def.label}を${label}`);
    }
  }
  const matched: string[] = [];
  for (const [action, label] of candidates) {
    if (label.toLowerCase().includes(needle)) matched.push(action);
    if (matched.length >= limit) break;
  }
  return matched;
};

// ---- 種類（操作のまとまり） ----

export interface AuditCategory {
  value: string;
  label: string;
  /** この種類に入る操作の先頭の語（「語.」で始まる操作が入る）。リソース名はテーブル名の形（_）で書く */
  prefixes: readonly string[];
}

export const AUDIT_CATEGORIES: readonly AuditCategory[] = [
  { value: 'auth', label: '認証', prefixes: ['auth', 'access'] },
  {
    value: 'equity',
    label: '株主・株式',
    prefixes: ['stakeholders', 'officers', 'share_classes', 'funding_rounds', 'share_transactions', 'equity'],
  },
  {
    value: 'options',
    label: '新株予約権・転換型',
    prefixes: ['option_plans', 'option_grants', 'option_events', 'convertible_rounds', 'convertible_investments'],
  },
  {
    value: 'meetings',
    label: '会議・手続き',
    prefixes: ['meetings', 'meeting_agenda_items', 'meeting_responses', 'compliance', 'compliance_task_states'],
  },
  {
    value: 'disclosure',
    label: '決算・お知らせ・文書',
    prefixes: ['financial_reports', 'shareholder_updates', 'documents', 'document_shares', 'document_templates'],
  },
  { value: 'sharing', label: '共有・出力', prefixes: ['share_links', 'portal_access', 'export', 'print'] },
  { value: 'members', label: 'メンバー・権限', prefixes: ['member', 'invite', 'invites', 'profiles', 'account'] },
  {
    value: 'settings',
    label: '設定・AI',
    prefixes: [
      'company',
      'organization',
      'organizations',
      'fiscal_years',
      'ai',
      'ai_settings',
      'ai_credentials',
      'credential',
      'import',
      'document_extractions',
    ],
  },
  { value: 'audit', label: '監査', prefixes: ['audit_log', 'access_review'] },
];

/** どの種類にも入らない操作 */
export const OTHER_CATEGORY = 'other';
export const OTHER_CATEGORY_LABEL = 'その他';

export const isAuditCategory = (value: string): boolean =>
  value === OTHER_CATEGORY || AUDIT_CATEGORIES.some((category) => category.value === value);

export const auditCategoryLabel = (value: string): string =>
  value === OTHER_CATEGORY ? OTHER_CATEGORY_LABEL : (AUDIT_CATEGORIES.find((category) => category.value === value)?.label ?? value);

/** 操作の先頭の語（最初の . の前）。リソース名（share-transactions）はテーブル名の形にそろえる */
const actionHead = (action: string): string => toTableName(action.split('.')[0] ?? '');

/** 操作がどの種類に入るか。どれにも入らなければ 'other' */
export const auditCategoryOf = (action: string): string => {
  const head = actionHead(action);
  return AUDIT_CATEGORIES.find((category) => category.prefixes.includes(head))?.value ?? OTHER_CATEGORY;
};

/**
 * 種類に入る操作を DB で絞るための LIKE のパターン（「語.%」）。
 * LIKE の _ は任意の 1 文字に合うので、share_transactions.% はリソース名の share-transactions.… にも合う。
 * 'other' は「どのパターンにも合わない」で絞るので、すべての種類のパターンを返す。
 */
export const categoryActionPatterns = (value: string): string[] => {
  const categories = value === OTHER_CATEGORY ? AUDIT_CATEGORIES : AUDIT_CATEGORIES.filter((category) => category.value === value);
  return categories.flatMap((category) => category.prefixes.map((prefix) => `${prefix}.%`));
};

// ---- 操作した人・対象 ----

/** ロールの表示名（記録した時点の値）。知らない値はそのまま返す */
export const auditRoleLabel = (role: string | null | undefined): string => {
  if (!role) return '';
  return isMemberRole(role) ? memberRoleLabel(role) : role;
};

export const SYSTEM_ACTOR_LABEL = 'システム';

type ActorFields = Pick<AuditLogItem, 'userId' | 'actorName' | 'actorEmail' | 'actorRole'>;

/**
 * 操作した人の表示。1 行目は氏名（無ければメールアドレス）、2 行目はメールアドレスと当時のロール。
 * 操作した人が決まらない記録（システムの処理・ログインの失敗・共有リンクからのアクセス）は「システム」。
 */
export const describeActor = (item: ActorFields): { primary: string; secondary: string } => {
  if (!item.userId && !item.actorEmail) return { primary: SYSTEM_ACTOR_LABEL, secondary: '' };
  const role = auditRoleLabel(item.actorRole);
  const primary = item.actorName || item.actorEmail || '削除済みのアカウント';
  const secondary = [item.actorName ? item.actorEmail : null, role].filter(Boolean).join('・');
  return { primary, secondary };
};

type EntityFields = Pick<AuditLogItem, 'action' | 'entityName' | 'entityId' | 'entityLabel'>;

/** 対象の表示。type は対象の種類（テーブルの日本語名）、name は行の名前（分かるときだけ） */
export const describeEntity = (item: EntityFields): { type: string; name: string | null } => {
  if (item.action === 'ai.request') return { type: 'AI の用途', name: item.entityLabel ?? item.entityName };
  return { type: tableLabel(item.entityName), name: item.entityLabel };
};

// ---- 改ざんの検査 ----

const VERIFY_REASON_LABELS: Record<string, string> = {
  gap: '連番が飛んでいます（記録が抜き取られた可能性があります）',
  prev_hash_mismatch: '直前の記録のハッシュとつながりません（記録が差し替えられた可能性があります）',
  hash_mismatch: '記録の内容とハッシュが合いません（記録が書き換えられた可能性があります）',
};

export const verifyReasonLabel = (reason: string): string => VERIFY_REASON_LABELS[reason] ?? `検査で問題が見つかりました（${reason}）`;

// ---- アカウントの棚卸し ----

const ACCOUNT_STATUS_LABELS: Record<string, string> = {
  active: '利用中',
  never: '未ログイン',
  dormant: '長期間ログインなし',
  banned: '停止中',
};

export const accountStatusLabel = (status: string): string => ACCOUNT_STATUS_LABELS[status] ?? status;

export const accountStatusTone = (status: string): string =>
  status === 'active' ? 'gt-pill-good' : status === 'banned' ? 'gt-pill-bad' : status === 'dormant' || status === 'never' ? 'gt-pill-warn' : 'gt-pill-neutral';

// 監査ログ・アカウントの棚卸しの CSV。サーバ依存なし。
//
// 形式: UTF-8（先頭に BOM。Excel が UTF-8 として開く）・カンマ区切り・改行は CRLF・RFC 4180 の引用。
// セルが = + - @ タブ 復帰（と、日本語の Excel が数式として読む全角の ＝ ＋ － ＠）で始まるときは、
// 先頭に ' を付けて、表計算ソフトが数式として実行しないようにする（CSV インジェクションの対策）。

import type { AccountAccessResponse } from '../types';
import { formatJstDateTime, toUtcIso } from './format';
import { accountStatusLabel, auditActionLabel, auditRoleLabel } from './labels';

export const CSV_BOM = '﻿';

export type CsvCell = string | number | null | undefined;

const FORMULA_START = /^[=+\-@\t\r＝＋－＠]/;

/** 数式として読まれる文字で始まるセルを、文字として読ませる */
export const neutralizeCell = (text: string): string => (FORMULA_START.test(text) ? `'${text}` : text);

export const escapeCsvCell = (value: CsvCell): string => {
  if (value == null) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  const text = neutralizeCell(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export const toCsvLine = (cells: readonly CsvCell[]): string => `${cells.map(escapeCsvCell).join(',')}\r\n`;

/** 2 次元の配列（先頭の行は見出し）を CSV の文字にする */
export const buildCsv = (rows: readonly (readonly CsvCell[])[]): string => CSV_BOM + rows.map(toCsvLine).join('');

// ---- 監査ログ ----

/** CSV に出す 1 行。変更前後の値は、DB が持っている文字のまま（jsonb を text にしたもの）で受け取る */
export interface AuditLogExportRow {
  id: string;
  organizationId: string;
  userId: string | null;
  action: string;
  entityName: string;
  entityId: string | null;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
  seq: number | null;
  prevHash: string | null;
  hash: string | null;
  source: string;
  outcome: string;
  actorEmail: string | null;
  actorRole: string | null;
  oldValuesText: string | null;
  newValuesText: string | null;
}

export const AUDIT_LOG_CSV_HEADER: readonly string[] = [
  '連番',
  '日時（UTC）',
  '日時（日本時間）',
  '記録元',
  '結果',
  '操作',
  '操作（表示名）',
  '対象の種類',
  '対象のID',
  '操作した人のID',
  '操作した人のメールアドレス',
  '操作した人のロール',
  'IPアドレス',
  'ユーザーエージェント',
  'リクエストの番号',
  '詳細',
  '変更前の値',
  '変更後の値',
  '直前の記録のハッシュ',
  'ハッシュ',
  '記録のID',
  '組織のID',
];

/**
 * 監査ログの 1 行を CSV の 1 行にする。
 * 値は DB のままで出す（ハッシュを計算し直せるように、表示名に置き換えない）。読みやすさのために表示名の列を 1 つ足す。
 */
export const auditLogCsvRow = (row: AuditLogExportRow): CsvCell[] => [
  row.seq,
  toUtcIso(row.createdAt),
  formatJstDateTime(row.createdAt),
  row.source,
  row.outcome,
  row.action,
  auditActionLabel(row.action, row.source),
  row.entityName,
  row.entityId,
  row.userId,
  row.actorEmail,
  row.actorRole,
  row.ipAddress,
  row.userAgent,
  row.requestId,
  row.detail,
  row.oldValuesText,
  row.newValuesText,
  row.prevHash,
  row.hash,
  row.id,
  row.organizationId,
];

// ---- アカウントの棚卸し ----

export const ACCOUNT_ACCESS_CSV_HEADER: readonly string[] = [
  '区分',
  '氏名',
  'メールアドレス',
  'ロール',
  '紐づく株主',
  '作成日時（日本時間）',
  '最後のログイン（日本時間）',
  '二要素認証',
  '状態',
  '招待の有効期限（日本時間）',
  '招待した人',
  'アカウントのID',
];

/** アカウントと、受け取られていない招待を 1 つの表にする（区分の列で見分ける） */
export const accountAccessCsvRows = (data: AccountAccessResponse): CsvCell[][] => [
  [...ACCOUNT_ACCESS_CSV_HEADER],
  ...data.accounts.map((account): CsvCell[] => [
    'アカウント',
    account.fullName,
    account.email,
    auditRoleLabel(account.role),
    account.stakeholderName,
    formatJstDateTime(account.createdAt),
    formatJstDateTime(account.lastSignInAt),
    account.mfaFactorCount > 0 ? '登録済み' : '未登録',
    accountStatusLabel(account.status),
    '',
    '',
    account.id,
  ]),
  ...data.invites.map((invite): CsvCell[] => [
    '招待中',
    '',
    invite.email,
    auditRoleLabel(invite.role),
    invite.stakeholderName,
    formatJstDateTime(invite.createdAt),
    '',
    '',
    invite.isExpired ? '期限切れ' : '招待中',
    formatJstDateTime(invite.expiresAt),
    invite.invitedByName,
    '',
  ]),
];

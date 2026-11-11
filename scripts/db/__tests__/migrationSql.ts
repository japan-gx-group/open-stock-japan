// マイグレーションの机上検証（実 DB を使わないテスト）で共通に使う読み込みヘルパー。
// 検証対象は supabase/migrations/*.sql そのもの。初期スキーマは 3 本に分かれている:
//   20261111000000_schema.sql  … テーブル・索引・トリガー
//   20261111000001_rls.sql     … RLS・権限（GRANT）・RPC
//   20261111000002_storage.sql … Storage のバケット

import { readFileSync } from 'node:fs';
import path from 'node:path';

export const MIGRATION_FILES = {
  schema: '20261111000000_schema.sql',
  rls: '20261111000001_rls.sql',
  storage: '20261111000002_storage.sql',
} as const;

export const readMigration = (name: keyof typeof MIGRATION_FILES): string =>
  readFileSync(path.join(process.cwd(), 'supabase/migrations', MIGRATION_FILES[name]), 'utf8');

/** コメント行を落とし、改行・連続空白を 1 つのスペースに畳んだ SQL 本文 */
export const collapseSql = (sql: string): string =>
  sql
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .map((line) => line.replace(/\s+--\s.*$/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');

/** 関数定義（create … function name(…) … $$;）を取り出す。無ければ空文字 */
export const functionDefinition = (body: string, name: string): string =>
  body.match(new RegExp(`create (or replace )?function ${name}\\(.*?\\$\\$;`))?.[0] ?? '';

/** `create table name ( … );` を取り出す。無ければ空文字 */
export const tableDefinition = (body: string, name: string): string =>
  body.match(new RegExp(`create table ${name} \\(.*?\\);`))?.[0] ?? '';

/** 指定テーブルに付くポリシー（create policy … on name …;）の一覧 */
export const policiesOn = (body: string, table: string): string[] =>
  (body.match(/create policy[^;]*;/g) ?? []).filter((policy) =>
    new RegExp(`" on ${table} `).test(policy),
  );

/** authenticated（または anon）へ権限を与える grant 文の一覧 */
export const grantsToBrowserRoles = (body: string): string[] =>
  (body.match(/grant [^;]*;/g) ?? []).filter((statement) => /\bto [^;]*\b(authenticated|anon)\b/.test(statement));

// AI の設定と API キー（20261111000000_schema.sql §10 と 20261111000001_rls.sql）に対する
// 回帰テスト（実DBを使わない机上検証）。
//
// - ai_settings は 1 組織 = 1 行で、API キーの列を持たない。社内メンバーは自組織の分を読めるだけ
//   （書き込みは管理者を確かめたうえで service_role から）
// - ai_credentials は暗号文・IV・タグ・暗号化の鍵の指紋・末尾 4 文字だけを持ち、平文の鍵の列を持たない。
//   RLS を有効にしてポリシーも GRANT も置かない（ブラウザ側からは一切読めない。読み書きは service_role だけ）
// - 提供元は 3 社だけ

import { describe, expect, it } from 'vitest';
import { collapseSql, grantsToBrowserRoles, policiesOn, readMigration, tableDefinition } from './migrationSql';

const schema = collapseSql(readMigration('schema'));
const rls = collapseSql(readMigration('rls'));

describe('ai_settings', () => {
  const table = tableDefinition(schema, 'ai_settings');

  it('1 組織 = 1 行（organizationId が主キー）で、組織の削除で消える', () => {
    expect(table).toContain('"organizationId" uuid primary key references organizations(id) on delete cascade');
  });

  it('API キーの列を持たない', () => {
    expect(table).not.toMatch(/api_?key|secret|ciphertext/i);
  });

  it('提供元は anthropic / google / openai だけ', () => {
    expect(table).toContain("check (provider in ('anthropic', 'google', 'openai'))");
  });

  it('authenticated への GRANT は select だけ', () => {
    expect(rls).toContain('grant select on ai_settings to authenticated;');
    expect(rls).not.toMatch(/grant [^;]*(insert|update|delete)[^;]* on ai_settings to authenticated/);
  });
});

describe('ai_credentials', () => {
  const table = tableDefinition(schema, 'ai_credentials');

  it('1 組織 = 1 行で、組織の削除で消える', () => {
    expect(table).toContain('"organizationId" uuid primary key references organizations(id) on delete cascade');
  });

  it('暗号文・IV・タグ・指紋・末尾 4 文字だけを持ち、平文の鍵の列を持たない', () => {
    for (const column of [
      'ciphertext text not null',
      'iv text not null',
      '"authTag" text not null',
      '"keyId" varchar(16) not null',
      '"keyLast4" varchar(4) not null',
    ]) {
      expect(table).toContain(column);
    }
    expect(table).not.toMatch(/"?api_?key"?\s+(text|varchar)/i);
  });

  it('提供元は anthropic / google / openai だけ', () => {
    expect(table).toContain("check (provider in ('anthropic', 'google', 'openai'))");
  });

  it('RLS を有効にし、ポリシーも、anon・authenticated への GRANT も置かない', () => {
    expect(rls).toContain('alter table ai_credentials enable row level security;');
    expect(policiesOn(rls, 'ai_credentials')).toEqual([]);
    expect(grantsToBrowserRoles(rls).filter((statement) => statement.includes('ai_credentials'))).toEqual([]);
  });

  it('読み書きは service_role に与える', () => {
    expect(rls).toContain('grant select, insert, update, delete on all tables in schema public to service_role;');
  });
});

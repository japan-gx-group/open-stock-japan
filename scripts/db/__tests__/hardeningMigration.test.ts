// 公開前のセキュリティの点検で入れた、DB 側の締め直し（20261111000007_hardening.sql）に対する回帰テスト（机上検証）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collapseSql, functionDefinition } from './migrationSql';

const hardening = collapseSql(readFileSync(path.join(process.cwd(), 'supabase/migrations/20261111000007_hardening.sql'), 'utf8'));

describe('organizations の読み取り', () => {
  it('社内の人だけが読める（株主ロールのアカウントは、ブラウザから直接は読めない）', () => {
    expect(hardening).toContain('drop policy "organizations_select_own" on organizations;');
    expect(hardening).toContain(
      'create policy "organizations_select_own" on organizations for select to authenticated using (id = (select current_user_organization_id()) and (select current_user_is_internal()));',
    );
  });
});

describe('トリガー関数の実行権限', () => {
  it('最初のマイグレーションのトリガー関数から、PUBLIC・anon・authenticated の実行権限を外す', () => {
    for (const name of ['set_updated_at', 'set_audit_user_id', 'set_invite_inviter', 'check_option_event_units', 'ensure_organization_keeps_admin']) {
      expect(hardening).toContain(`revoke execute on function ${name}() from public, anon, authenticated;`);
    }
  });
});

describe('監査ログに残さない値', () => {
  it('トークン・暗号文に加えて、API キーの末尾 4 文字と指紋も伏せる', () => {
    const mask = functionDefinition(hardening, 'audit_mask_row');
    for (const column of ['token', 'tokenHash', 'ciphertext', 'iv', 'authTag', 'keyLast4', 'keyId']) {
      expect(mask).toContain(`'${column}'`);
    }
    expect(mask).toContain("set search_path = ''");
    expect(hardening).toContain('revoke execute on function audit_mask_row(jsonb) from public, anon, authenticated;');
  });
});

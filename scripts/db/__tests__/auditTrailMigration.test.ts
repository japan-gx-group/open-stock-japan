// 監査証跡（20261111000004_audit_trail.sql）に対する回帰テスト（実 DB を使わない机上検証）。
//
// - テーブルを足したのに「行の変更の記録」のトリガーを付け忘れる、という抜けを見つける
// - 監査ログが追記専用であること（更新・削除・全消去の拒否、権限の取り上げ）が、あとの変更で外れていないこと
// - ブラウザ（authenticated）から監査ログを読めない・書けないこと
//
// 実際の動き（連番・ハッシュの連鎖・改ざんの検出・ログインの記録）は、ローカルの DB で確かめる
// （手順は docs/system-audit.md の「導入時の確認」）。

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { collapseSql, functionDefinition } from './migrationSql';

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations');
const migrationFiles = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();
const all = collapseSql(migrationFiles.map((name) => readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')).join('\n'));
const audit = collapseSql(readFileSync(path.join(MIGRATIONS_DIR, '20261111000004_audit_trail.sql'), 'utf8'));

const allTables = [...all.matchAll(/create table (\w+) \(/g)].map((match) => match[1]);

describe('行の変更の記録（audit_row_change）', () => {
  it('監査ログ自身を除くすべてのテーブルに、追加・更新・削除のトリガーが付いている', () => {
    expect(allTables.length).toBeGreaterThan(20);
    const missing = allTables
      .filter((table) => table !== 'system_audit_logs')
      .filter(
        (table) =>
          !all.includes(
            `create trigger audit_${table} after insert or update or delete on ${table} for each row execute function audit_row_change();`,
          ),
      );
    // テーブルを足したら、同じ形のトリガーをマイグレーションに足すこと
    expect(missing).toEqual([]);
  });

  it('監査ログ自身には付けない（記録が記録を呼んで止まらなくなる）', () => {
    expect(all).not.toContain('create trigger audit_system_audit_logs');
  });

  it('秘密の値（招待・共有リンクのトークン、API キーの暗号文）を伏せ、長い値は文字数とハッシュだけにする', () => {
    const mask = functionDefinition(audit, 'audit_mask_row');
    for (const column of ['token', 'tokenHash', 'ciphertext', 'iv', 'authTag']) {
      expect(mask).toContain(`'${column}'`);
    }
    expect(mask).toContain('（秘匿）');
    expect(mask).toMatch(/length\(e\.value::text\) > 4000/);
  });

  it('操作した人は、ブラウザからの直接の操作では JWT の本人、サーバ経由ではサーバが渡すヘッダから取る', () => {
    const info = functionDefinition(audit, 'audit_request_info');
    expect(info).toMatch(/if v_role = 'authenticated' then return jsonb_build_object\( 'actor', auth\.uid\(\)/);
    expect(info).toMatch(/if v_role = 'service_role' then .*x-openstock-actor/);
  });
});

describe('監査ログは追記専用', () => {
  it('更新・削除・全消去をトリガーで拒否する', () => {
    expect(audit).toContain('create trigger system_audit_logs_no_update before update on system_audit_logs for each row execute function reject_audit_log_change();');
    expect(audit).toContain('create trigger system_audit_logs_no_delete before delete on system_audit_logs for each row execute function reject_audit_log_change();');
    expect(audit).toContain('create trigger system_audit_logs_no_truncate before truncate on system_audit_logs for each statement execute function reject_audit_log_change();');
  });

  it('保守の扱い（削除の許可）は、DB の管理者のセッションだけ。アプリの接続（authenticator）では有効にならない', () => {
    const maintenance = functionDefinition(audit, 'audit_maintenance_enabled');
    expect(maintenance).toContain("session_user in ('postgres', 'supabase_admin')");
    const reject = functionDefinition(audit, 'reject_audit_log_change');
    // 更新は、保守の扱いでも許さない
    expect(reject).toContain("if tg_op in ('DELETE', 'TRUNCATE') and public.audit_maintenance_enabled() then");
  });

  it('サーバ（service_role）からも、更新・削除の権限を取り上げる', () => {
    expect(audit).toContain('revoke update, delete, truncate, references, trigger on system_audit_logs from service_role;');
  });

  it('ブラウザ（anon・authenticated）からは読めない・書けない（ポリシーも権限も無い）', () => {
    expect(audit).toContain('drop policy "system_audit_logs_select_own_organization" on system_audit_logs;');
    expect(audit).toContain('drop policy "system_audit_logs_insert_own_organization" on system_audit_logs;');
    expect(audit).toContain('revoke all on system_audit_logs from anon, authenticated;');
    expect(audit).not.toMatch(/grant [^;]* on system_audit_logs to (anon|authenticated)/);
    expect(audit).not.toMatch(/create policy [^;]* on system_audit_logs/);
  });

  it('検査・棚卸し・内部の関数を、ブラウザから呼べない', () => {
    for (const signature of [
      'audit_maintenance_enabled()',
      'reject_audit_log_change()',
      'audit_request_info()',
      'audit_log_canonical(public.system_audit_logs)',
      'seal_audit_log()',
      'audit_mask_row(jsonb)',
      'audit_row_change()',
      'audit_auth_session()',
      'audit_auth_event()',
      'verify_audit_log_chain(uuid)',
      'list_account_access(uuid)',
    ]) {
      expect(audit).toContain(`revoke execute on function ${signature} from public, anon, authenticated;`);
    }
  });
});

describe('連番とハッシュの連鎖', () => {
  it('連番・記録時刻・ハッシュは DB が決める（呼び出し側の値を使わない）', () => {
    const seal = functionDefinition(audit, 'seal_audit_log');
    expect(seal).toContain('new.seq := coalesce(v_last.seq, 0) + 1;');
    expect(seal).toContain('new."createdAt" := clock_timestamp();');
    expect(seal).toContain(`new.hash := encode(sha256(convert_to(new."prevHash" || E'\\n' || public.audit_log_canonical(new), 'UTF8')), 'hex');`);
    // 組織ごとにロックを取り、同時の追加でも 1 本の連鎖にする
    expect(seal).toContain('pg_advisory_xact_lock');
  });

  it('封をするトリガーは、操作者を上書きするトリガー（set_system_audit_logs_user_id）より後に動く名前にする', () => {
    expect(audit).toContain('create trigger system_audit_logs_seal before insert on system_audit_logs for each row execute function seal_audit_log();');
    // 同じタイミングのトリガーは名前順に動く
    expect(['system_audit_logs_seal', 'set_system_audit_logs_user_id'].sort()).toEqual(['set_system_audit_logs_user_id', 'system_audit_logs_seal']);
  });

  it('ハッシュの対象に、行のすべての列を入れる（列を足したら canonical にも足す）', () => {
    const canonical = functionDefinition(audit, 'audit_log_canonical');
    const columns = [
      'seq', 'id', '"organizationId"', '"userId"', 'action', '"entityName"', '"entityId"', 'detail', '"oldValues"', '"newValues"',
      'source', 'outcome', '"actorEmail"', '"actorRole"', '"ipAddress"', '"userAgent"', '"requestId"', '"createdAt"',
    ];
    for (const column of columns) {
      expect(canonical).toContain(`r.${column}`);
    }
    // 連鎖の列（prevHash・hash）以外で、監査ログの列がこれで全部であること
    const added = [...audit.matchAll(/add column ("?\w+"?) /g)].map((match) => match[1]);
    expect(added.filter((column) => !['"prevHash"', 'hash'].includes(column)).every((column) => columns.includes(column))).toBe(true);
  });

  it('検査の関数は、連番の飛び・前の行とのつながり・行の内容の 3 つを確かめる', () => {
    const verify = functionDefinition(audit, 'verify_audit_log_chain');
    for (const reason of ['gap', 'prev_hash_mismatch', 'hash_mismatch']) {
      expect(verify).toContain(`'${reason}'`);
    }
  });
});

describe('認証の記録', () => {
  it('ログインの記録に失敗しても、ログインそのものは止めない', () => {
    for (const name of ['audit_auth_session', 'audit_auth_event']) {
      expect(functionDefinition(audit, name)).toMatch(/exception when others then raise warning .* return null;/);
    }
  });
});

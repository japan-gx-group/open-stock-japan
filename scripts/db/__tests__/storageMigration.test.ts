// Storage のバケット（20261111000002_storage.sql）に対する回帰テスト（実DBを使わない机上検証）。
//
// - documents バケットは非公開で、大きさと形式に上限がある
// - storage.objects に authenticated 向けのポリシーを作らない（ブラウザから直接は読めない・書けない。
//   アップロードとダウンロードはサーバが権限を確かめたうえで service_role で行う）
// - storage.buckets への insert は「migration は DDL 専用」の規約の例外で、検査（check-migrations）を通る

import { describe, expect, it } from 'vitest';
import { findViolations } from '../check-migrations.ts';
import { collapseSql, readMigration } from './migrationSql';

const sql = readMigration('storage');
const body = collapseSql(sql);

describe('documents バケット', () => {
  it('非公開で作る', () => {
    expect(body).toMatch(
      /insert into storage\.buckets \(id, name, public, file_size_limit, allowed_mime_types\) values \( 'documents', 'documents', false, 20971520, array\[/,
    );
  });

  it('何度流しても同じ結果になる（on conflict do nothing）', () => {
    expect(body).toContain('on conflict (id) do nothing;');
  });

  it('受け付ける形式は、PDF・画像・文字・Office 文書だけ（実行できる形式や HTML・SVG を含めない）', () => {
    const mimeTypes = [...body.matchAll(/'([\w.+-]+\/[\w.+-]+)'/g)].map((match) => match[1]);
    expect(mimeTypes).toContain('application/pdf');
    expect(mimeTypes.length).toBeGreaterThan(3);
    for (const mimeType of mimeTypes) {
      expect(mimeType).not.toMatch(/html|svg|javascript|octet-stream|zip|x-msdownload/);
    }
  });

  it('storage.objects にポリシーを作らない', () => {
    expect(body).not.toMatch(/create policy/);
    expect(body).not.toMatch(/\bgrant\b/);
  });

  it('バケットの定義だけなので、migration の検査（DDL 専用）を通る', () => {
    expect(findViolations(sql)).toEqual([]);
  });
});

-- OpenStock Japan v0.1 初期スキーマ (3/3): Storage
-- documents バケットは非公開。authenticated 向けのポリシーは作らない（= ブラウザから直接は読めない・書けない）。
-- アップロードとダウンロードは、サーバが権限（社内ロール / 株主への公開範囲 / 共有リンク）を確かめたうえで
-- service_role で行い、ダウンロードは短時間だけ有効な署名つき URL を返す。
-- storage.buckets への insert は DDL 専用規約の例外（バケット定義はスキーマの一部として扱う）。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  20971520,
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'text/plain',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
on conflict (id) do nothing;

# supabase/

Supabase のマイグレーション（スキーマ）・シード（データ）・ローカル設定を置くディレクトリです。
**スキーマとデータは置き場所を分けています。** マイグレーションには DDL だけを書き、データは `seeds/` に置きます。

## ディレクトリ構成

```
supabase/
├── config.toml                      # ローカル設定（ポートは 5532x。[db.seed] sql_paths = []）
├── migrations/                      # DDL のみ（データ禁止）。タイムスタンプ順に適用する
│   ├── 20261111000000_schema.sql
│   ├── 20261111000001_rls.sql
│   ├── 20261111000002_storage.sql
│   └── …                            # 以後の追加分（下の表）
├── seeds/
│   └── demo/
│       └── *.sql                    # デモ・テスト用データ（本番投入禁止）
└── README.md                        # このファイル
```

## セットアップ（ローカル開発）

```bash
npx supabase start                   # ローカル Supabase 起動（Docker 必須。Supabase CLI は npx で実行する）
npm run db:reset:demo                # DB を作り直し、スキーマ + デモデータを投入
```

`config.toml` はコミット済みなので `supabase init` は不要です。

## migrations/ — スキーマ（DDL のみ）

最初の 3 本が初期スキーマで、以後は追加のファイルです。`supabase db reset` / `supabase db push` がタイムスタンプ順に適用します。後のファイルは前のファイルのテーブル・関数に依存するため、この順番が前提です。

| ファイル | 収録物 |
|---|---|
| `20261111000000_schema.sql` | extension（`pgcrypto`）/ テーブル / 制約 / インデックス / トリガー関数とトリガー（`set_updated_at`、最後の管理者を守る `ensure_organization_keeps_admin` など） |
| `20261111000001_rls.sql` | RLS 補助関数（`current_user_organization_id()` / `current_user_is_admin()` / `current_user_is_internal()` など）/ `enable row level security` / ポリシー / テーブルの GRANT・REVOKE / `alter default privileges` / RPC（`change_member_role`・`touch_share_link`）と EXECUTE 権限 |
| `20261111000002_storage.sql` | Storage バケット（`documents`。非公開）の定義。マイグレーション内で唯一許容している DML |
| `20261111000003_compliance_task_states.sql` | 手続きカレンダーで、手で「完了」にした記録 |
| `20261111000004_audit_trail.sql` | 監査証跡。監査ログを追記専用にし、ハッシュの連鎖、全テーブルの行の変更の記録、ログインなどの認証の記録、検査と棚卸しの関数を足す（[docs/system-audit.md](../docs/system-audit.md)） |
| `20261111000005_auditor_role.sql` | 監査人ロール（`auditor`）と、社内の 4 つのロールの付け替え |
| `20261111000006_auth_policy.sql` | 認証の決まり（二要素認証を必須にする組織の設定と、二要素認証が済むまで DB を読ませないポリシー） |
| `20261111000007_hardening.sql` | 公開前の点検での締め直し（組織の情報を社内の人だけが読めるようにする、トリガー関数の実行権限、監査ログに残さない値の追加） |

**テーブルを足すときは、同じファイルに「行の変更の記録」のトリガー（`audit_<テーブル名>`）を足します。** 付け忘れは `scripts/db/__tests__/auditTrailMigration.test.ts` が見つけます。

### 権限の考え方

- 全テーブルで RLS を有効にし、`anon` には何も与えません。
- `authenticated`（ログイン中のブラウザ）から直接読めるのは、組織・プロフィール・招待・事業年度・AI 設定の、自組織の分だけです。組織・事業年度・AI 設定は社内の人だけ、株主ロールのアカウントは自分のプロフィールだけを読めます。二要素認証が済んでいないセッションには、何も返しません。
- 監査ログ（`system_audit_logs`）は、ブラウザからは読めず、書けません。追記専用で、サーバ（`service_role`）からも更新・削除はできません。読めるのは管理者と監査人で、サーバが権限を確かめてから返します。
- **株主・株式・新株予約権・会議・決算・文書などの業務テーブルには、`authenticated` 向けのポリシーも GRANT もありません。** 株主名簿は個人情報と持株を含み、社外の株主（ロール `shareholder`）のアカウントも同じ認証基盤に乗るため、PostgREST を直接叩いても業務テーブルへ届かない形にしています。読み書きはすべてサーバ（Server Action / Route Handler）が、ロールと組織を確かめたうえで `service_role` で行います（`src/lib/authz.ts` の `requireInternal()` / `requireEditor()` / `requireAdmin()`）。
- `rls.sql` §4 は 2 段構えです。既存テーブルへの `revoke all … from anon, authenticated`（Supabase の default privileges が自動付与した ALL を剥がす）と、`alter default privileges … revoke`（以後 `public` に作られるテーブル・シーケンス・関数を `anon` / `authenticated` へ自動公開しない）です。後者があるため、**テーブルを追加しても、明示的に `grant` しない限りブラウザからは見えません。** 関数だけは PUBLIC への `execute` が PostgreSQL 組み込みの既定で default privileges からは外せないため、**関数ごとに `revoke execute … from public, anon[, authenticated]` を書く**運用が必要です。
- `documents` バケットは非公開で、`storage.objects` に `authenticated` 向けのポリシーを作りません。アップロードとダウンロードはサーバが権限を確かめたうえで `service_role` で行い、ダウンロードは短時間だけ有効な署名つき URL を返します。

ロールは 5 つです（`src/types/role.ts`）。

| ロール | 説明 |
|---|---|
| `admin` | 管理者。組織の設定（企業情報・事業年度・メンバー）まで行える |
| `logger` | 社内メンバー。業務データを編集できる |
| `viewer` | 社内の閲覧のみ |
| `auditor` | 監査人。業務データと監査ログを読めるが、何も変えられない |
| `shareholder` | 社外の株主。株主ポータルだけを使える。`profiles.stakeholderId` で権利者に紐づく |

スキーマを変えるときは、すでにあるファイルを編集せず、新しいタイムスタンプ付きファイルを追加します。

マイグレーションに **データを書くことは禁止** です。`insert` / `update` / `delete` / `copy` / `truncate` / `merge` は、組織・ユーザーでも、既存行の訂正（バックフィル）でも `migrations/` には置かず、`seeds/` に置きます（例外は `storage.buckets` への `insert` / `update`（バケットの定義と設定変更）だけ。バケットはインフラ設定であり、Supabase 公式の作成手段が SQL のためです。`20261111000002_storage.sql` がこの例外に当たります）。`npm run check:migrations` が機械的に検出します。

## seeds/ — データ

| ディレクトリ | 内容 | 本番 | いつ流れるか |
|---|---|---|---|
| `seeds/demo/` | 架空のデモ組織・デモユーザー・株主名簿などのサンプルデータ | **投入しない** | 自動では流れない。`npm run db:reset:demo` または `npm run db:seed:demo` で明示的に入れたときだけ |

- このアプリには、本番環境へ投入する共通マスタがありません。本番の DB にはシードを流しません。
- シードは **冪等**（`on conflict … do nothing / do update`、または削除→再投入）に書きます。何度流しても同じ結果になります。
- シードは 1 ファイルを 1 トランザクション（`psql --single-transaction`）で流すため、ファイルの中に `begin` / `commit` や psql のメタコマンド（`\` で始まる行）を書きません。
- デモのログイン情報が使えるのは、**デモシードを入れたときだけ** です。`supabase db reset` だけでは組織もユーザーも作られないため、その場合はアプリの初期セットアップ画面（`/signup`）から組織と管理者を作ります（最初の事業年度と「普通株式」も同時に作られます）。
- デモアカウントは公開のパスワードを使います。**本番の DB には絶対に投入しないでください。**

## コマンド一覧

Supabase CLI は `npx supabase …` で実行します（devDependency には追加していません。`npm run db:*` も `npx supabase` を呼びます）。`npm run …` は `package.json` に定義したコマンドの短縮形です。稼働中の DB へシードを流す `db:seed:demo` は `scripts/db/seed.ts` が担当し、ローカル Supabase の DB コンテナ内で `psql -v ON_ERROR_STOP=1` を実行します（`--db-url` 指定時はホストの `psql` を使います）。

| 目的 | コマンド | 備考 |
|---|---|---|
| ローカル DB を作り直す（スキーマのみ） | `npx supabase db reset`（= `npm run db:reset`） | `config.toml` の `[db.seed].sql_paths` は空 |
| ローカル DB を作り直す + デモデータ | `npm run db:reset:demo`（= `npx supabase db reset --sql-paths "./seeds/demo/*.sql"`） | `--sql-paths` は `supabase/` からの相対パス |
| 稼働中のローカル DB にデモデータを入れる | `npm run db:seed:demo`（= `node scripts/db/seed.ts demo`） | ローカル Supabase が起動していること |
| クラウド: スキーマを反映 | `npx supabase db push` | `supabase link` 済みのプロジェクトへ |
| クラウド（検証用のみ）: デモデータ | `npm run db:seed:demo -- --db-url postgresql://… --force` | **本番プロジェクトでは行わない**（誤投入防止のため、`--db-url` 指定時は `--force` が無いと拒否される） |
| マイグレーションが DDL だけかを検査 | `npm run check:migrations` | CI と lefthook の pre-commit でも自動実行 |

## ルール

- **マイグレーションの不変性**: `migrations/` の既存ファイルは編集・削除しない。スキーマ変更は新しいタイムスタンプ付きファイルを追加する（変更は追加のみ）。
- **マイグレーションにデータを入れない（DDL 専用）**: データは `seeds/demo/`（テスト・デモ用）へ。既存データの訂正も seed を直して再投入する（migration で `update` しない）。
- 機械チェック: `npm run check:migrations`。

## 新しいマイグレーションを追加する

```bash
npx supabase migration new add_xxx_column   # migrations/<timestamp>_add_xxx_column.sql が作られる
```

1. 作られたファイルに **DDL だけ** を書く（テーブル・列・制約・インデックス・関数・トリガー・ポリシー・GRANT・`comment on`）。書式は既存ファイルに合わせる（小文字キーワード、2 スペースインデント、camelCase 識別子はダブルクォート）。コメントは SQL を読んでも分からないこと（セキュリティ上の前提・意図・運用上の落とし穴）だけを短く書く。
   - **新しいテーブルでは必ず `enable row level security` を書く。** ブラウザから読ませる必要があるテーブルだけ、ポリシーと `grant` を明示する（株主ロールに見えてよいかを必ず確かめる）。業務テーブルは GRANT もポリシーも書かず、サーバから `service_role` で読み書きする。
   - 関数は `revoke execute … from public, anon[, authenticated]` → `grant execute` を対にして書く。`create or replace function` は既存の EXECUTE 権限を保つが `drop` → `create` は PUBLIC 公開に戻るので、作り直すときも同じ対を再適用する。
2. 既存ファイル（初期スキーマの 3 本を含む）は編集しない。列の追加も削除も、必ず新しいファイルで行う。
3. 新しい列に既存行の値を入れたい場合は、migration に `update` を書かない。
4. `npm run check:migrations` と `npx supabase db reset` で確認してからコミットする。

> `.env` やアクセスキーをこのディレクトリにコミットしないこと。

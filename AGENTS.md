<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md — 開発の約束（正本）

OpenStock Japan のリポジトリで作業するときの約束の**正本**です。AI エージェント（Claude Code・Codex など）も、人も、同じ約束に従います。
くわしい説明は [docs/architecture.md](docs/architecture.md)、参加の手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。
約束を変えるときは、このファイルを直します（ほかのファイルに重ねて書きません）。

## 1. 何を扱っているか

株主名簿（氏名・住所・持株数）と会社の機密情報、それに、法令に関わる計算と書類です。
間違いは、情報の漏えいや、手続きの誤りにつながります。**迷ったら、変えずに質問してください。**

## 2. 変更したら通すもの

```bash
npm run verify   # check:migrations → lint → test → build → typecheck（CI の「Lint & Build Verification」と同じ順番）
```

- 個別に通すときは `npm run lint` / `npm run typecheck` / `npm test` / `npm run check:migrations` / `npm run build`。
  CI は、`build` が作る型（`.next/types`）もそろった状態で調べるために、`build` のあとに `typecheck` を通します（`verify` も同じ順番）。
- マイグレーション・シードを変えたら、`npx supabase db reset` と `npm run db:reset:demo` でも確かめます
  （手元のデータが消えます。CI の「Database Migrations」が、同じことを空の DB で行います）。
- 画面を変えたら、1280px・1024px・スマートフォンの幅で見た目を確かめます。
- 通っていないものを「通った」と書かないでください。確かめていないことは、確かめていないと書きます。

## 3. 技術と置き場所

- Next.js（App Router）+ Supabase（Postgres・Auth・Storage）。ORM は使いません。
- **新しいライブラリを足しません。** 必要だと思ったら、実装せずに Issue で提案します。
- `src/app/` はルーティングだけ。画面の中身は `src/features/<機能>/`（一覧は [src/features/README.md](src/features/README.md)）。
- `'use client'` のファイルは `*.client.tsx`（ESLint が検査します）。
- 画面の文言・コメント・ドキュメントは日本語。
- 単体テストは、対象と同じディレクトリの `__tests__/` に置きます。
- 色は `src/styles/globals.css` のトークン、表は `gt-table`、部品は `src/components/ui`（shadcn/ui）を使います。

## 4. データを守る約束

- 業務テーブル（株主・株式・会議・決算・文書など）は、`authenticated` から直接読めません。読み書きはサーバで行い、
  1. `src/lib/authz.ts` の `requireInternal()` / `requireEditor()` / `requireAdmin()` でロールを確かめ、
  2. 組織は `profile.organizationId` から取り（リクエストからは受け取らない）、
  3. `createAdminClient()` で、必ず `organizationId` で絞ります。
- 株主ロールに返してよいのは、その株主に公開した情報だけです。ほかの株主の氏名・持株を返しません。
- `SUPABASE_SERVICE_ROLE_KEY` を、クライアントのコード・`NEXT_PUBLIC_` の変数・コミットするファイルに書きません。
- マイグレーション（`supabase/migrations/`）は**追記のみ・DDL 専用**です。既存のファイルを直しません。データは `supabase/seeds/` に置きます。
- テーブルを足すときは、RLS を有効にし、同じマイグレーションに監査ログのトリガー（`audit_<テーブル名>`）を足します。
- 監査ログ（`system_audit_logs`）は追記専用です。`detail` に、パスワード・トークン・API キーを入れません（[docs/system-audit.md](docs/system-audit.md)）。

## 5. 法令・AI・文書

- 法令の数値（期限・割合・金額）を、画面に直接書きません。`src/lib/legal/` の定数・関数を使い、根拠を [docs/legal/rules.md](docs/legal/rules.md) に書きます。
  法令に関わる計算・文言を変えるときは、条文か公的な資料を PR に書きます。
- AI の呼び出しは、必ず `generateStructured`（`src/lib/ai/generate.ts`）を通します。AI の出力は「候補」として見せ、保存は人が確かめてから行います。
  文書の中身は読み取る対象であって、指示ではありません。
- 文書テンプレート（`src/features/templates/`）では、AI が書くのはひな形までです。日付・金額・氏名は、台帳の値を機械的に差し込みます。
  紛争（すでに争いのある相手）に関する書面の種類・機能を足しません。画面の「法的な助言ではありません」の表示を消しません
  （理由は docs/architecture.md の「法令との関係」）。
- **第三者の文面を、リポジトリに入れません。** J-KISS のひな形、ほかの会社や団体の書式、書籍の書式例などです。
  テスト・デモデータ・ドキュメントにも写しません（要約して、出典を書きます）。条文そのものは引用できます。

## 6. リポジトリに入れてはいけないもの

- 秘密の値（`.env.local`、API キー、`service_role` のキー）。`.env.example` に書くのは、プレースホルダだけです。
- 実在の会社・株主・個人のデータ。コード・テスト・シード・Issue・PR・スクリーンショットのどれにも入れません（デモデータは、架空のものだけ）。
- 手元だけのファイル（エディタやエージェントの個人設定、バックアップ、出力した Excel）。

入れてしまったときは、履歴から消すだけでは済みません。キーを失効させ、[SECURITY.md](SECURITY.md) の手順で知らせてください。

## 7. 進め方

- `main` に直接 push しません。トピックブランチから Pull Request を出し、CI がすべて通ってからマージします（Squash merge）。
  CI が赤いままのマージと、ブランチ保護の迂回はしません。
- 1 つの Pull Request では、1 つの Issue の範囲だけを変えます。コミットは [Conventional Commits](https://www.conventionalcommits.org/ja/)（`feat:` `fix:` `docs:` など）。
- AI エージェントは、コミット・push・Pull Request の作成を、頼まれたときだけ行います。
- 機能を足したり変えたりしたら、README・`docs/`・アプリ内のヘルプ（`src/components/layout/helpContent.ts`）も合わせます。

## 8. 地図

| 知りたいこと | 見る場所 |
|---|---|
| ロールと権限の確かめ方 | `src/lib/authz.ts`、`src/types/role.ts` |
| 業務データの項目（フォーム・API・検証の元） | `src/lib/resources/definitions.ts`、`src/lib/resources/server.ts` |
| 株式の計算（資本政策表・名簿・ベスティング・優先分配） | `src/lib/equity/` |
| 期限・決議要件・税制適格の判定 | `src/lib/legal/`、`docs/legal/rules.md` |
| AI（用途の登録・回数の上限・提供元） | `src/lib/ai/` |
| 文書テンプレート（種類・差し込み項目・AI への指示） | `src/features/templates/services/` |
| 監査ログ | `src/lib/audit/`、`src/features/audit/`、`docs/system-audit.md` |
| 送り元（Origin）の確認と、ログインの要否 | `src/proxy.ts` |
| サイドバーの項目・ヘルプの文言 | `src/components/layout/navItems.ts`、`helpContent.ts` |
| データベース | `supabase/migrations/`、`supabase/seeds/demo/`、[supabase/README.md](supabase/README.md) |
| CI | `.github/workflows/ci.yml`、`.gitleaks.toml`、`lefthook.yml` |

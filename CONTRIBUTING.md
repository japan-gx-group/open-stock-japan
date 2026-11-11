# コントリビューションガイド

OpenStock Japan へのご関心ありがとうございます。
このドキュメントは、バグ報告・機能提案・コード貢献の進め方をまとめたものです。

> OpenStock Japan は「スタートアップの株主名簿・資本政策・ストックオプション・株主総会・取締役会・株主コミュニケーションを一元管理するオープンソースツール」です。
> 法令（会社法など）に関わる計算・文言を変える場合は、根拠となる条文や公的な資料を PR に書いてください。

---

## 目次

- [行動規範](#行動規範)
- [はじめる前に](#はじめる前に)
- [開発環境のセットアップ](#開発環境のセットアップ)
- [Issue を立てる](#issue-を立てる)
- [ブランチ運用](#ブランチ運用)
- [コミットメッセージ](#コミットメッセージ)
- [Pull Request の流れ](#pull-request-の流れ)
- [コミット前チェックリスト](#コミット前チェックリスト)

---

## 行動規範

すべての参加者は [行動規範（Code of Conduct）](CODE_OF_CONDUCT.md) に従うものとします。

## はじめる前に

- 大きな変更や新機能は、**実装前に Issue で提案**してください。方針がずれた実装をレビュー段階で作り直すのを避けるためです。
- 新しいライブラリの追加は原則行いません。必要な場合は実装せず Issue / PR コメントで提案してください。
- 開発の約束の正本は [`AGENTS.md`](AGENTS.md) です（AI エージェントと人の共通）。下の「コードの決まり」は、その要点です。
- **第三者の文面を入れないでください。** J-KISS のひな形、ほかの会社や団体の書式、書籍の書式例などは、テスト・デモデータ・ドキュメントにも写しません（要約して、出典を書きます）。

## 開発環境のセットアップ

前提: **Node.js 24 以上**

```bash
# 1. フォーク & クローン
git clone https://github.com/<your-account>/open-stock-japan.git
cd open-stock-japan

# 2. 依存インストール（lefthook の git hook も自動セットアップされます）
npm install

# 3. 環境変数を用意（.env.example をコピーして値を埋める）
cp .env.example .env.local

# 4. ローカル DB を用意（Docker 必須。詳細は supabase/README.md）
npx supabase start       # ローカル Supabase を起動
npm run db:reset:demo    # マイグレーション + デモデータで DB を作り直す

# 5. 開発サーバ起動 → http://localhost:3100
npm run dev
```

`.env.local` は**絶対にコミットしない**でください。`SUPABASE_SERVICE_ROLE_KEY` などの秘密情報の扱いは [`SECURITY.md`](SECURITY.md) を参照。

ローカル DB の作り直しやデモデータの流し方、マイグレーションの運用ルール（既存ファイルを編集しない・データを入れない）は [`supabase/README.md`](supabase/README.md) を参照してください。

## コードの決まり（要点）

- UI の文言・コメント・ドキュメントは日本語で書きます。
- `'use client'` を持つコンポーネントのファイル名は `<Name>.client.tsx` にします（ESLint が検査します）。
- 単体テストは、対象ファイルと同じディレクトリの `__tests__/` に置きます。
- 機能ごとのコードは `src/features/<domain>/` に置きます（[`src/features/README.md`](src/features/README.md)）。
- 株主・株式・会議・文書などの業務テーブルは、サーバ（Server Action / Route Handler）からだけ読み書きします。`service_role` のクライアントを作る前に、`src/lib/authz.ts` の `requireInternal()` / `requireEditor()` / `requireAdmin()` で権限を確かめてください。
- 色は `src/styles/globals.css` の `@theme` のトークンを使い、値を直接書きません。
- 表は `gt-table` と `gt-table-scroll` を使い、セルは既定で折り返しません。文章を入れるセルにだけ `gt-wrap-sm` / `gt-wrap` / `gt-wrap-lg` を付けます（`globals.css` の「テーブル」の節）。画面を変えたら、1280px と 1024px の幅でも確かめてください。
- テーブルを足すときは、同じマイグレーションに監査ログのトリガー（`audit_<テーブル名>`）を足します。監査ログに、パスワード・トークン・API キーなどの秘密の値を入れません（[`docs/system-audit.md`](docs/system-audit.md)）。

## Issue を立てる

- バグ報告・タスクは [Issue テンプレート](.github/ISSUE_TEMPLATE/) を使ってください。
- **セキュリティ上の脆弱性は公開 Issue に書かないでください。** 報告方法は [`SECURITY.md`](SECURITY.md) を参照。

## ブランチ運用

`main` を安定ブランチとし、作業はトピックブランチで行います。

**ブランチ名の形式:**

```
<type>/<issue番号>-<短い説明>
```

例:

| 目的 | ブランチ名の例 |
|---|---|
| 新機能 | `feature/34-cap-table-waterfall` |
| バグ修正 | `fix/57-dashboard-total` |
| ドキュメント | `docs/62-update-readme` |
| リファクタ | `refactor/40-shareholders-service` |
| 雑務・設定 | `chore/60-configure-lefthook` |

- `main` へ直接 push しないでください。必ず PR 経由でマージします。
- 1 つのブランチ / PR では、**担当 Issue の範囲だけ**を変更します（「ついで」の変更を混ぜない）。

## コミットメッセージ

[Conventional Commits](https://www.conventionalcommits.org/ja/) に従います。

```
<type>: <日本語または英語の要約>
```

主な `type`:

| type | 用途 |
|---|---|
| `feat` | 新機能 |
| `fix` | バグ修正 |
| `docs` | ドキュメントのみ |
| `refactor` | 挙動を変えない内部改善 |
| `test` | テストの追加・修正 |
| `chore` | ビルド・設定・依存など |
| `ci` | CI 設定 |

例: `feat: 資本政策表に完全希薄化後の比率を追加`

## Pull Request の流れ

1. `main` から最新を取り込み、トピックブランチを作成する
2. 変更を実装し、[コミット前チェックリスト](#コミット前チェックリスト)をすべて通す
3. PR を作成する（[PR テンプレート](.github/PULL_REQUEST_TEMPLATE.md)が自動で開きます）
   - 関連 Issue を `Closes #34` のように記載する
   - 何を・なぜ変えたかを説明する
4. **CI（Secret Scan / Lint & Build Verification / Database Migrations）がグリーン**になっていることを確認する
5. レビューコメントが付いた場合は対応し、スレッドを解決する
6. メンテナが内容を確認し、マージします（**Squash merge のみ**。マージ後にトピックブランチは自動削除されます）

> `main` へのマージは、**CI がグリーンで、レビューコメントがすべて解決済み**であることが条件です。
> fork からの Pull Request はマージ権限を持たないため、メンテナが確認したうえでマージします。

> ⚠️ **CI が赤い状態でのマージ、およびブランチ保護のバイパスは禁止**です。
> 根本原因を修正してからマージしてください。

## コミット前チェックリスト

コミット / PR 前に、ローカルで以下がすべて通ることを確認してください。

```bash
npm run verify            # 下の 5 つを、CI と同じ順番でまとめて通す

npm run check:migrations  # マイグレーションが DDL だけである
npm run lint              # ESLint が通る
npm run test              # テストが通る
npm run build             # 本番ビルドが通る
npm run typecheck         # 型エラーが無い（CI と同じく、build のあとに通す）
```

マイグレーション・シードを変えた場合は、`npx supabase db reset` と `npm run db:reset:demo` も通してください（CI の Database Migrations が、空の DB で同じことを行います）。

**lefthook（git フック）が自動実行するのは一部だけです。** pre-commit で走るのは次の 3 つで、`build` と `test` は走りません（`lefthook.yml`）。

| フック | 実行条件 | 内容 |
|---|---|---|
| `lint` | `*.ts` / `*.tsx` をステージしたとき | ステージしたファイルに `eslint --fix`（修正結果は自動で再ステージ） |
| `check-migrations` | `supabase/migrations/*.sql` をステージしたとき | マイグレーションに DML が混入していないか検査 |
| `check-ignored-sources` | 毎回 | ソースのファイルが `.gitignore` に当たって、コミットから漏れていないか検査 |

`build` と `test` の失敗はフックでは検出できないため、**push 前に `npm run verify` を自分で流してください**。強制力の本丸は CI 側（シークレット走査 / check:migrations / lint / test / build / typecheck / 空の DB へのマイグレーションとデモシードの適用）です。

---

ご不明点は Issue または PR コメントでお気軽にどうぞ。貢献に感謝します。

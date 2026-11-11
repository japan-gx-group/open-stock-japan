# src/features/ — 機能（ドメイン）別ディレクトリ

機能ごとにコードを凝集させる場所です。

| ディレクトリ | 機能 |
|---|---|
| `dashboard/` | ダッシュボード（株式の概要・期限の近い手続き） |
| `cap-table/` | 資本政策表（完全希釈化後の比率・次回ラウンドの試算・優先分配の試算・Excel への出力） |
| `shareholders/` | 株主名簿・権利者・株式の異動 |
| `rounds/` | 資金調達ラウンド・株式の種類 |
| `convertibles/` | J-KISS などの転換型の証券 |
| `stock-options/` | ストックオプション（回次・割当・税制適格のチェック・新株予約権原簿） |
| `meetings/` | 株主総会・取締役会（招集・議案・出欠・議事録） |
| `templates/` | 文書テンプレート（招集通知・議事録・J-KISS の発行に使う書類のひな形。AI での作成と、台帳の値の差し込み） |
| `compliance/` | 手続きカレンダー |
| `company/` | 会社情報・役員 |
| `financials/` | 決算情報 |
| `updates/` | 株主へのお知らせ |
| `library/` | 文書のライブラリと共有 |
| `import/` | AI による文書の取り込み（読み取り → 確認 → 台帳へ反映） |
| `portal/` | 株主ポータル（`/external-portal`。株主が見る画面） |
| `portal-access/` | 株主ポータルへの招待・取り消し |
| `legal-guide/` | 法令ガイド（`docs/legal/` をアプリ内で読む） |
| `audit/` | 監査ログ（操作の記録・アカウントの棚卸し・改ざんの検査） |
| `ai/` | AI の設定（API キー・利用するモデル）と、送信前の確認ダイアログ |
| `auth/` | ログイン・二要素認証・初期セットアップ・招待・パスワード再設定 |
| `settings/` | アカウント設定・企業情報（基本項目）・事業年度・メンバー管理・セキュリティの設定 |

```
src/features/<domain>/
├── components/   # その機能専用のUI（Client Component は <Name>.client.tsx、Server Component は <Name>.tsx）
│   └── __tests__/
├── hooks/        # その機能専用のhook
│   └── __tests__/
├── services/     # データ取得・保存（Supabaseアクセス）
│   └── __tests__/
├── utils/        # （任意）Supabase に触れない純粋なヘルパー
└── types.ts      # その機能専用の型
```

サブディレクトリは必要なものだけ持ちます。
単体テストは対象ファイルと同じディレクトリの `__tests__/` に、同じファイル名 + `.test.ts(x)` で置きます。

## データアクセスの決まり

- 組織・プロフィール・招待・事業年度・AI 設定は、ブラウザのクライアント（RLS 前提）から自組織の分だけ読めます。
- 監査ログは、ブラウザからは読めません。読めるのは管理者と監査人で、サーバが `requireAuditReader()` で確かめてから返します。
  行の変更は DB のトリガーが自動で記録するので、機能のコードで残すのは、行の変更だけでは分からない操作（ダウンロード・出力など）だけです。
- 株主・株式・新株予約権・会議・決算・文書などの業務テーブルは、`authenticated` に権限がありません。読み書きはすべてサーバ（Server Action / Route Handler）で、`src/lib/authz.ts` の `requireInternal()` / `requireEditor()` / `requireAdmin()` を通したあと、service_role のクライアントで行い、クエリは必ず `profile.organizationId` で絞ります。
- ロールの判定は `src/types/role.ts` のヘルパー（`isAdmin` / `isInternal` / `canEdit` / `canReadAuditLog` / `isShareholder`）を使います。

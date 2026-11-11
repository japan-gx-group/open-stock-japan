<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-dark.svg">
    <img src="public/logo.svg" alt="OpenStock Japan" width="320">
  </picture>
</p>

# OpenStock Japan

スタートアップの**株主名簿・資本政策・ストックオプション・株主総会・取締役会・株主コミュニケーション**を一元管理する、オープンソースのウェブアプリです。日本の会社法・税法の実務に合わせて作っています。

> [!IMPORTANT]
> 画面に出る期限・要件の判定と、テンプレートから作る文書は、実務の目安です。法的助言・税務助言ではありません。
> 定款・株主間契約・投資契約の定めと、弁護士・司法書士・税理士の判断が常に優先します。

## できること

| 分野 | 内容 |
|---|---|
| 株主名簿 | 会社法121条の記載事項（氏名・住所・株式の種類と数・取得日）。基準日時点の名簿、Excel 出力、譲渡・分割の記録、台帳の整合チェック |
| 資本政策表 | 種類株式の普通株換算、完全希釈化後の比率、J-KISS の転換（プレマネー / ポストマネーのキャップ・ディスカウント）、次回ラウンドのシミュレーション、優先分配（ウォーターフォール）の試算 |
| 資金調達・種類株式 | ラウンドと割当ての記録、種類株式の内容、資本金組入額・登録免許税・登記期限の目安 |
| ストックオプション | 回次・割当・行使・失効、ベスティング、税制適格の要件チェック（行使期間・行使価額・年間上限・大口株主）、新株予約権原簿 |
| 株主総会・取締役会 | 招集通知の期限、議案と決議要件（普通・特別・特殊決議）の判定、出欠・委任状・書面決議の同意、招集通知と議事録の下書き |
| 文書テンプレート | 招集通知・議事録・書面決議・委任状と、J-KISS の発行に使う書類のひな形。AI に書かせるか、手元のひな形の空欄を差し込み項目に置き換えて作り、会議や回次を選ぶと、日付・議案・金額の入った文書になります |
| 手続きカレンダー | 定時総会・登記・申告・調書・役員の任期満了など、期限のある手続きの洗い出し |
| 決算情報 | 期ごとの主要な数字、グラフ、株主への公開 |
| 株主コミュニケーション | お知らせ・月次レポートの作成と公開、株主が自分の保有状況と公開資料を見られる株主ポータル（`/external-portal`） |
| ライブラリ・共有 | 定款・契約書・議事録などの保管、株主ごとの公開範囲、期限つき共有リンク |
| AI | 契約書・登記事項証明書・議事録・決算書の PDF から台帳への取り込み、フォームの入力補助、文章の下書き、文書テンプレートの作成。提供元は Anthropic（Claude）・Google（Gemini）・OpenAI から選べます |
| 法令ガイド | 会社法・租税特別措置法などの整理（[docs/legal/](docs/legal/)）をアプリ内でも読めます |
| 監査への対応 | すべての変更を変更前後の値つきで残す追記専用の監査ログ（改ざんの検査つき）、ログイン・出力の記録、二要素認証、監査人ロール、アカウントの棚卸し（[docs/system-audit.md](docs/system-audit.md)） |

AI が読み取った内容はすべて「候補」として表示され、台帳に書き込まれるのは人が確かめて保存したときだけです。

文書テンプレートでは、AI が書くのは「ひな形」までです。日付・議案・人数・金額・氏名は、文書を作るときに台帳の値を機械的に差し込みます（AI は使いません）。J-KISS の投資契約書・発行要項のひな形は同梱していません。公開元（Coral Capital）のひな形を貼り付けると、文面は変えずに、記入する箇所だけを差し込み項目に置き換えます。すでに争いのある相手に関する書面（請求の通知・和解契約書・裁判所に出す書面など）には使えません。

## 構成

- [Next.js](https://nextjs.org/)（App Router）+ [Supabase](https://supabase.com/)（Postgres・Auth・Storage）
- 1 デプロイ = 1 社を想定した自社ホスト型。株主名簿などの業務データは、ブラウザから直接は読めない設計です（[docs/architecture.md](docs/architecture.md)）

## はじめかた（ローカル）

必要なもの: Node.js 24 以上、Docker

```bash
git clone https://github.com/japan-gx-group/open-stock-japan.git
cd open-stock-japan
npm install

# ローカルの Supabase を起動（初回はイメージの取得に数分かかります）
npx supabase start

# 表示された API URL・anon key・service_role key を .env.local に設定
cp .env.example .env.local

# デモデータ入りでデータベースを作り直す
npm run db:reset:demo

npm run dev   # http://localhost:3100
```

デモデータ（架空の会社）のログイン。パスワードはすべて `password123` です。

| メールアドレス | ロール |
|---|---|
| `admin@example.com` | 管理者 |
| `member@example.com` | メンバー |
| `viewer@example.com` | 閲覧のみ |
| `audit@example.com` | 監査人（データと監査ログを見られますが、何も変えられません） |
| `shareholder@example.com` | 株主（株主ポータルだけ使えます） |

デモデータを入れずに始める場合は `npm run db:reset` のあと、`/signup` で最初の管理者と会社を登録します。

本番環境の用意、招待メール、AI の設定は [docs/setup-guide.md](docs/setup-guide.md) を参照してください。本番では、最初の登録（`/signup`）にセットアップ用の合言葉（環境変数 `SETUP_TOKEN`）が必要です。

## ドキュメント

- [docs/setup-guide.md](docs/setup-guide.md) — セットアップと運用
- [docs/architecture.md](docs/architecture.md) — 構成と実装の約束
- [docs/system-audit.md](docs/system-audit.md) — システム監査への対応（監査ログ・認証・運用する会社が行うこと・限界）
- [docs/legal/](docs/legal/) — 法令の整理と、アプリが使っている数値の根拠（[rules.md](docs/legal/rules.md)）
- [docs/brand.md](docs/brand.md) — ロゴと配色
- [CONTRIBUTING.md](CONTRIBUTING.md) — 開発への参加
- [SECURITY.md](SECURITY.md) — 脆弱性の報告

## 開発

```bash
npm run verify             # 下の検査と本番ビルドを、CI と同じ順番でまとめて通す

npm run lint
npm run typecheck
npm test
npm run check:migrations   # マイグレーションが DDL だけであることの検査
```

開発の約束は [AGENTS.md](AGENTS.md)（AI エージェントと人の共通の正本）、参加の手順は [CONTRIBUTING.md](CONTRIBUTING.md) にあります。

## 法令について

[docs/legal/](docs/legal/) は、2026 年 11 月 11 日時点の e-Gov 法令検索・国税庁・経済産業省・法務省・金融庁の公表資料で確認した内容の整理です。確認できなかった事項は各ファイルの末尾に明記しています。法改正があった場合は、`docs/legal/rules.md` と `src/lib/legal/` の定数を合わせて更新してください（改正の報告・修正の Pull Request を歓迎します）。

## ライセンス

[Apache License 2.0](LICENSE)（著作権表示と、もとにしたソフトウェア・書体は [NOTICE](NOTICE)）

「J-KISS」は、Coral Capital が公開している投資契約書のひな形と、それに基づく新株予約権を指す名称です。ひな形の文面は、このリポジトリに含まれていません（扱いの整理は [docs/legal/02-share-issuance.md](docs/legal/02-share-issuance.md) の 6.1.1）。OpenStock Japan は、Coral Capital と提携・協賛の関係にありません。

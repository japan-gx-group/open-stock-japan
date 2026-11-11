# アーキテクチャと実装の約束

OpenStock Japan の構成と、機能を足すときに守る約束をまとめる。法令の整理は [docs/legal/](legal/) を参照。

## 構成

- Next.js（App Router）1 本と Supabase（Postgres・Auth・Storage）。ORM は使わない。
- `src/app/` はルーティングだけ。画面の中身は `src/features/<機能>/` に置き、ページは薄くする。
- `'use client'` を付けるファイルは `*.client.tsx` という名前にする（ESLint で検査）。
- 画面の文言・コメント・ドキュメントは日本語。
- UI は shadcn/ui（`src/components/ui`）と `src/styles/globals.css` の `gt-*` クラス、アイコンは lucide-react、グラフは recharts。

## ロールとデータの守り方

| ロール | 値 | できること |
|---|---|---|
| 管理者 | `admin` | すべて（組織の設定・メンバー・AI の設定・会社情報の変更を含む） |
| メンバー | `logger` | 業務データの閲覧と編集 |
| 閲覧のみ | `viewer` | 業務データの閲覧 |
| 監査人 | `auditor` | 業務データと監査ログ・アカウントの棚卸しの閲覧（何も変えられない） |
| 株主 | `shareholder` | 株主ポータル（`/external-portal`）だけ |

- 業務テーブル（株主・株式・新株予約権・会議・決算・文書など）は、`authenticated` に GRANT もポリシーも与えていない。
  ブラウザから PostgREST を直接叩いても読めず、読み書きは必ずサーバ（Route Handler）を通る。
- サーバでは次の順で扱う。
  1. `src/lib/authz.ts` の `requireInternal()`（読む）/ `requireEditor()`（書く）/ `requireAdmin()` でロールを確かめる。
  2. 組織 ID は `profile.organizationId` から取る（リクエストからは受け取らない）。
  3. `createAdminClient()`（service_role）で、必ず `organizationId` で絞って読み書きする。
  4. 行の変更（追加・更新・削除）は、DB のトリガーが変更前後の値つきで `system_audit_logs` に必ず残す
     （アプリは何もしなくてよい）。行の変更だけでは分からない操作（ダウンロード・出力・まとめての記録など）は、
     `recordAudit()` / `recordAuditEvent()` で残す。
- 監査ログ（`system_audit_logs`）は追記専用で、ハッシュの連鎖を持つ。読めるのは管理者と監査人だけ（`requireAuditReader()`）。
  「だれが・どこから」は、`src/proxy.ts` が確かめた本人の id を `createAdminClient()` が DB へヘッダで渡し、DB のトリガーが残す。
  仕組みと運用は [system-audit.md](system-audit.md)。**テーブルを足すときは、同じマイグレーションに
  `audit_<テーブル名>` のトリガーを足すこと**（付け忘れは `scripts/db/__tests__/auditTrailMigration.test.ts` が見つける）。
- `getCurrentProfile()` は、二要素認証が済んでいないあいだ（登録済みなのにコードを入力していない／組織が必須にしているのに
  未登録）は `null` を返す。そのため、権限のチェックを通るのは、二要素認証まで済んだセッションだけになる。
  ログイン・二要素認証の画面は `getSessionState()`（`src/lib/sessionState.ts`）で状態を読む。
  ログインは `POST /api/auth/login` を通し、失敗の記録と、失敗が続いたときのロックを行う。
  パスワードの決まりは `src/lib/security/passwordPolicy.ts` の 1 か所で確かめる。
- 株主ポータルの API は `getCurrentProfile()` で本人を確かめ、`profile.stakeholderId` に紐づく情報と、
  公開された情報（お知らせ・決算・文書）だけを返す。他の株主の氏名・持株は返さない。

## リソース定義（フォーム・API・AI 補助の共通の元）

`src/lib/resources/definitions.ts` に、業務データごとの項目（`FieldDef`）を定義している。この 1 つの定義から

- サーバでの入力の検証（`parseResourceInput`）と保存する列
- 汎用 API: `GET/POST /api/resources/<name>`、`PATCH/DELETE /api/resources/<name>/<id>`
- 入力フォーム: `ResourceFormDialog`（`src/components/resource/ResourceFormDialog.client.tsx`）
- AI の入力補助が返す値の形（`src/lib/resources/aiSchema.ts`）

が決まる。項目を足すときは、マイグレーションで列を足し、定義に 1 行足す。

画面からは次を使う。

```tsx
import { useResourceList } from '@/hooks/useResourceList';
import { useEquitySnapshot } from '@/hooks/useEquitySnapshot';   // 株式・SO・転換型の台帳一式
import { useCompany } from '@/hooks/useCompany';                 // 会社情報と機関設計（governance）
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { DraftDialog } from '@/components/resource/DraftDialog.client';      // AI による文章の下書き
import { ComposeDialog } from '@/features/templates/components/ComposeDialog.client'; // 文書テンプレートから文書を作る
import { StatTile, StatGrid, LoadingBlock, ErrorBlock, EmptyState, NoticeList } from '@/components/resource/parts';
import { deleteItem, saveItem, listItems, apiFetch, errorMessage } from '@/lib/resources/client';
```

- 一覧は `useResourceList('meetings')`、絞り込みは `useResourceList('meeting-agenda-items', 'meetingId', id)`。
  保存・削除のあとは `reload()` を呼ぶ。
- 登録・編集は `ResourceFormDialog` に `resource` と `initial`（編集する行）または `defaults`（新規の初期値）を渡す。
  親の id のように画面で決まっている項目は `defaults` で入れて `hiddenKeys` で隠す。
- 権限による出し分けは `useCurrentUser()` の `role` と `canEdit(role)` / `isAdmin(role)`（`src/types/role.ts`）。
  出し分けは表示だけで、権限の正しさはサーバが確かめる。

## 計算と法令

- `src/lib/equity/`: 資本政策表（`buildCapTable`）、株主名簿（`buildRegistry`）、台帳の整合チェック（`checkLedger`）、
  ベスティング（`vestingStatus`）、優先分配（`computeWaterfall`）、日本語の数値・日付の入出力（`format.ts`）。
- `src/lib/legal/`: 期限と決議要件（`rules.ts`）、税制適格ストックオプションの要件チェック（`taxQualified.ts`）、
  手続きカレンダー（`calendar.ts`）。数値の根拠は `docs/legal/rules.md`。
- どちらもサーバ依存の無い純粋な関数で、画面・API・テストのどこからでも使える。法令の数値を画面に直接書かず、
  ここの関数・定数を使う。

## AI

- AI の呼び出しは必ず `src/lib/ai/generate.ts` の `generateStructured` を通す（用途の登録・入力の検査・回数の上限・
  監査ログが入る）。提供元は Anthropic・Google（Gemini）・OpenAI から選べ、モデルは管理者が画面で選ぶ。
- AI の出力は「候補」として画面に出し、台帳への保存は人が確かめてから行う。
- 文書は読み取る対象であって指示ではない（指示文にその旨を書き、出力は必ず検証する）。

## 文書テンプレート

招集通知・議事録・J-KISS の発行に使う書類などのひな形（`document_templates`）。実装は `src/features/templates/`。

- 文面には、差し込み項目を `{{会社名}}` のように書く。一覧は `services/placeholders.ts`、種類ごとに使える項目・記載する事項・
  AI への指示は `services/kinds.ts`（種類の id は `src/lib/resources/definitions.ts` の `TEMPLATE_KINDS` と、DB の check 制約）。
- **AI が書くのは、ひな形まで。** 日付・議案・人数・金額・氏名は、文書を作るときに台帳の値を機械的に差し込む
  （`POST /api/templates/compose` → `services/values.ts`・`services/fill.ts`。AI は使わない）。値が無い項目は「【要確認: 項目名】」になる。
- AI の使い方は 2 つ（`POST /api/ai/template`。用途は `template_writing`）。
  - `mode: 'write'` … 種類ごとのひな形を書かせる。送るのは会社の機関設計と、利用者の要望・参考の文面だけ（台帳の値は送らない）。
    一覧に無い差し込み項目は「【要確認】」に置き換える。
  - `mode: 'convert'` … 手元のひな形の空欄を、差し込み項目に置き換える。AI は「どこを・どの項目に」の案を返すだけで、
    置き換えは `services/convert.ts` が行う。空欄以外の文字が変わる案は使わない（契約書の文面を AI に書き換えさせない）。
- 契約書（`convertible_contract`）は AI に書かせない。J-KISS のひな形は同梱しない（公開元のものを、利用者が貼り付けて使う）。
- `status` は、人が文面を確かめたかどうか（`draft` = 確認中 / `reviewed` = 確認済み）。確認済みのテンプレートの文面を変えると、
  サーバが確認中に戻す（`src/lib/resources/server.ts`）。
- 差し込み項目を足すときは、`placeholders.ts` に足し、`values.ts` で値を入れる（入れ忘れは `values.test.ts` が見つける）。
  種類を足すときは、マイグレーションで check 制約を作り直し、`TEMPLATE_KINDS` と `kinds.ts` に足す。

### 法令との関係（文書を作る機能を変えるとき・第三者に提供するとき）

2026-11-12 に確認した内容。法的な助言ではなく、最終的な判断は個別の事実関係による。

- **第三者のひな形（J-KISS など）を、リポジトリに入れない。** 公開元は J-KISS を「オープンソースとして無償公開」と説明しているが、
  再配布の条件を定めた文書は公開されていない。テスト・デモデータ・ドキュメントにも、文面を写さない
  （要約と出典の記載にとどめる）。詳しくは [legal/02-share-issuance.md](legal/02-share-issuance.md) の 6.1.1。
- **弁護士法 72 条**（弁護士でない者が、報酬を得る目的で、他人の法律事件に関する法律事務を業として取り扱うことの禁止）。
  法務省の[令和 8 年 8 月のガイドライン](https://www.moj.go.jp/content/001469040.pdf)（[概要](https://www.moj.go.jp/content/001469039.pdf)。
  [令和 5 年 8 月のガイドライン](https://www.moj.go.jp/content/001400675.pdf)を補うもの）は、
  ①紛争（事件性のある案件）に使わせることを目指した設計でなく、②そのような利用に特化した機能を持たず、③不適切な利用を避ける体制が
  ある場合、書面の作成・審査・管理の支援や、株主総会・取締役会などの会議業務の支援は、一般に同条に抵触しないとしている
  （概要の第 2 の 3）。あわせて、弁護士の判断の代わりになる・法的な結論の正しさを保証すると受け取られる表現を使わないこと、
  紛争には使えない旨を入力の前と出力に示すこと、根拠を示すこと、弁護士への相談を勧めることを求めている（概要の第 3）。
  このツールは次のようにしている。変えるときは、この線を越えないこと。
  - 種類（`kinds.ts`）は、会社が自社で作る書類だけ。裁判所に出す書面・和解契約書など、紛争を前提にした書面の種類を足さない。
  - AI への指示（`prompts.ts` の `DISPUTE_RULE`）で、紛争に関する書面を書かせない。
  - AI に頼む画面と、テンプレートの画面に、法的な助言ではないこと・正しさを保証しないこと・紛争には使えないこと・
    専門家に確認することを表示する。種類ごとに、根拠の条文を表示する。
  - AI が書くのはひな形までで、人が確かめて「確認済み」にする。日付・金額・氏名は、台帳の値を機械的に差し込む。
- 同条が禁じているのは、他人の法律事件に関する法律事務を、報酬を得る目的で、業として扱うこと。会社が自社の書類を自社で作るために
  使うかぎり、これには当たらない。**このツールを第三者に有償で提供する場合**
  （ホスティングして料金を受け取るなど）は、提供する人が、上のガイドラインと、司法書士法・行政書士法などの士業の法令に
  沿っているかを確かめること。

## 文書

- ファイルは Storage の `documents` バケット（非公開）。`src/lib/documents/server.ts` を通して保存・読み出しする。
- API: `GET/POST /api/documents`、`PATCH/DELETE /api/documents/<id>`、`GET /api/documents/<id>/download`
  （権限を確かめて署名つき URL へリダイレクト）。
- 公開範囲（`visibility`）: `internal`（社内のみ）/ `shareholders`（全株主）/ `restricted`（`document_shares` で指定した株主）。

## データベース

- マイグレーション（`supabase/migrations/`）は追記のみ・DDL 専用。データは `supabase/seeds/` に置く
  （`npm run check:migrations` で検査）。
- 新しいテーブルは RLS を有効にし、業務テーブルなら authenticated に何も付与しない。

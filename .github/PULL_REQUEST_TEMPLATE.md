<!-- PR タイトルは Conventional Commits 形式で（例: feat: 株主名簿の CSV 出力を追加） -->

## 概要 / Summary

<!-- 何を・なぜ変更したかを簡潔に -->

## 関連 Issue / Related Issue

<!-- 例: Closes #34 -->
Closes #

## 変更内容 / Changes

-
-

## 動作確認 / How to test

<!-- レビュアーが再現できる手順。スクリーンショットがあれば添付 -->

-

## チェックリスト / Checklist

- [ ] 担当 Issue の範囲だけを変更した（「ついで」の変更を含めていない）
- [ ] `npm run verify` が通る（check:migrations / lint / test / build / typecheck）
- [ ] 新しいライブラリを勝手に追加していない（追加が必要な場合は Issue/コメントで提案済み）
- [ ] `SUPABASE_SERVICE_ROLE_KEY` をクライアント側に露出させていない
- [ ] 業務テーブルを読む・書くサーバ処理は、`requireInternal()` / `requireEditor()` / `requireAdmin()` を通し、`organizationId` で絞っている（株主ロールに他の株主の情報を返さない）
- [ ] 実在の株主・会社のデータを、コード・テスト・スクリーンショットに含めていない
- [ ] 第三者の文面（契約書のひな形・ほかの会社や団体の書式・書籍の書式例）を写していない
- [ ] 法令に関わる計算・文言を変えた場合、根拠（条文・公的な資料）を書いた
- [ ] `.env.local` などの秘密情報をコミットしていない
- [ ] 既存の SQL マイグレーションを直接編集・削除していない（新規ファイルで対応した）
- [ ] マイグレーションにデータ（insert / update / delete 等）を入れていない（データは `supabase/seeds/demo` に置き、`npm run check:migrations` が通る）
- [ ] [`CONTRIBUTING.md`](../CONTRIBUTING.md) の決まりに従っている

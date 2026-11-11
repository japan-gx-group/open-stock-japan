#!/bin/sh
# ソースのファイルが .gitignore に当たって、コミットから漏れていないかを確かめる。
#
# 実行: sh scripts/check-ignored-sources.sh        （lefthook の pre-commit が毎回実行する）
# 終了コード: 0 = 漏れなし / 1 = 無視されているソースがある（一覧を出す）
#
# 背景: .gitignore の `logs`（ログ置き場を無視する行）が、同じ名前のソースのフォルダ
#   src/app/api/audit/logs/ にも当たり、3 つの Route Handler がコミットから漏れかけた。
#   手元では動くので気づけず、クローンした人の環境でだけ 404 になる。
#   CI は「コミットされたもの」しか見ないので、この検査は手元（コミットの前）でしか意味が無い。
#
# 対象: ソース・文書・マイグレーション・シード・公開ファイル・GitHub の設定。
#   Supabase CLI が作る作業用のフォルダ（supabase/.temp・supabase/.branches）は対象にしない。

ignored=$(git ls-files --others --ignored --exclude-standard -- src scripts docs supabase/migrations supabase/seeds supabase/config.toml public .github)

if [ -n "$ignored" ]; then
  echo "次のファイルが .gitignore で無視されています（コミットされません）:" >&2
  echo "$ignored" | sed 's/^/  /' >&2
  echo ".gitignore の該当する行を、先頭に / を付けてルート直下だけに絞るなどして直してください。" >&2
  echo "確かめ方: git check-ignore -v <ファイル>" >&2
  exit 1
fi

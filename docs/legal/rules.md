# rules.md — ソフトウェアに実装すべき数値ルール一覧

> **免責**: 本書は一般的な要約であり、法的助言・税務助言ではありません。定款・契約に別段の定めがある場合があります。
> **確認日**: 2026-11-11
> **確認できたか** 列の意味:
> - `verified` … e-Gov 法令検索 API で 2026-11-11 に取得した現行条文、又は所管官庁（国税庁・経済産業省・金融庁・法務省）の公式ページ・資料で数値を確認
> - `verified (template)` … Coral Capital 公開の J-KISS 2.0 ひな形（v2.01）で確認。契約ごとに変更可能な初期値
> - `unverified` … 一次資料で確認できず（解釈・実務・二次情報）
>
> 「定款可変」と記した値は会社ごとの設定値として保持すること。詳細と出典 URL は `01`〜`06` の各ファイルを参照。

## A. 株主名簿・株式（→ 01）

| rule id | 内容 | 数値/期限 | 適用条件 | 根拠条文 | 確認できたか |
|---|---|---|---|---|---|
| `record_date_max_months` | 基準日株主が行使できる権利は基準日から一定期間内に行使するものに限る | 3か月 | 全会社 | 会社法124条2項 | verified |
| `record_date_public_notice_days` | 基準日の公告期限（基準日の前） | 14日（2週間前まで） | 定款に当該基準日・権利内容の定めがある場合は不要 | 会社法124条3項 | verified |
| `registry_inspection_refusal_lookback_years` | 名簿閲覧で知り得た事実を利益を得て第三者に通報した者の請求を拒める期間 | 過去2年以内 | 株主名簿・新株予約権原簿・会計帳簿・委任状等に共通 | 会社法125条3項4号、252条3項、433条2項5号 | verified |
| `transfer_approval_notice_days` | 譲渡承認請求から決定通知までの期限。徒過でみなし承認 | 14日（2週間）以内 | 定款で短縮可（定款可変）。合意で別段の定め可 | 会社法145条1号、139条2項 | verified |
| `transfer_buyback_notice_days_company` | 不承認通知から会社による買取通知（供託証明書面交付を含む）までの期限。徒過でみなし承認 | 40日以内 | 定款で短縮可 | 会社法145条2号、141条、施規26条1号 | verified |
| `transfer_buyback_notice_days_designated` | 不承認通知から指定買取人による買取通知までの期限 | 10日以内 | 定款で短縮可 | 会社法145条2号、142条、施規26条2号 | verified |
| `transfer_price_petition_days` | 買取通知から裁判所への売買価格決定申立ての期限 | 20日以内 | 申立てなし・協議不調なら1株当たり純資産額×株式数 | 会社法144条2項・5項 | verified |
| `transfer_certificate_deposit_days` | 供託証明書面の交付から株券供託までの期限 | 7日（1週間）以内 | 株券発行会社のみ | 会社法141条3項、142条3項 | verified |
| `transfer_approval_organ` | 譲渡承認の決定機関 | 取締役会設置: 取締役会／非設置: 株主総会（普通決議） | 定款で別段の定め可（定款可変） | 会社法139条1項 | verified |
| `heir_sale_demand_deadline_years` | 相続人等への売渡請求ができる期間（会社が相続等を知った日から） | 1年以内 | 定款に定めがある場合。株主総会特別決議 | 会社法174条、175条、176条1項 | verified |
| `treasury_share_voting_rights` | 自己株式の議決権 | 0（議決権なし。定足数・賛成数の分母から除外） | 全会社 | 会社法308条2項 | verified |
| `treasury_buyback_period_max_years` | 株主との合意による自己株式取得の取得期間の上限 | 1年 | 株主総会決議で定める | 会社法156条1項 | verified |
| `stock_split_organ` | 株式分割の決定機関 | 取締役会設置: 取締役会／非設置: 株主総会普通決議 | 基準日の設定が必要 | 会社法183条2項 | verified |
| `stock_consolidation_resolution` | 株式併合の決議 | 株主総会特別決議 | 全会社 | 会社法180条2項、309条2項4号 | verified |
| `shareholder_list_top_n` | 登記添付の株主リスト記載範囲（総会決議の場合） | 議決権上位10名 又は 議決権割合2/3に達するまで、のいずれか少ない方 | 登記事項に株主総会決議を要する場合 | 商業登記規則61条3項（法務省ページで確認） | verified |

## B. 募集株式・資本・登記・開示規制（→ 02）

| rule id | 内容 | 数値/期限 | 適用条件 | 根拠条文 | 確認できたか |
|---|---|---|---|---|---|
| `share_issuance_resolution_private` | 募集事項の決定 | 株主総会特別決議 | 非公開会社 | 会社法199条2項、309条2項5号 | verified |
| `share_issuance_delegation_max_days` | 募集事項決定の取締役（会）への委任の有効期間（決議日から払込期日／払込期間末日まで） | 1年以内 | 非公開会社。株式数の上限・払込金額の下限を定める | 会社法200条1項・3項 | verified |
| `rights_offering_notice_days` | 株主割当ての場合の株主への通知期限（申込期日の前） | 14日（2週間前まで） | 株主割当て | 会社法202条4項 | verified |
| `allotment_notice_deadline` | 割当数の通知期限 | 払込期日（期間の初日）の前日まで | 総数引受契約の場合は不要 | 会社法204条3項、205条1項 | verified |
| `capital_half_rule` | 払込額のうち資本金に計上しないことができる上限 | 払込額の1/2以下（残額は資本準備金） | 株式の発行（自己株式処分を除く） | 会社法445条2項・3項 | verified |
| `authorized_shares_multiple_max` | 発行可能株式総数 ÷ 発行済株式総数 の上限 | 4倍 | **公開会社の増加時・公開会社となる定款変更時のみ**。非公開会社は制限なし | 会社法113条3項、37条3項、180条3項 | verified |
| `authorized_shares_min` | 発行可能株式総数の下限 | 発行済株式総数以上 | 全会社 | 会社法113条2項 | verified |
| `warrant_share_reserve` | 行使期間到来済み新株予約権の目的株式数の上限 | 発行可能株式総数 −（発行済株式総数 − 自己株式数） | 全会社 | 会社法113条4項 | verified |
| `class_meeting_special_quorum` | 種類株主総会特別決議の定足数 | 議決権の過半数（定款で1/3以上に緩和可） | 種類株式発行会社 | 会社法324条2項 | verified |
| `class_meeting_special_threshold` | 種類株主総会特別決議の賛成 | 出席議決権の2/3以上 | 322条1項の行為、譲渡制限種類株式の募集等 | 会社法324条2項 | verified |
| `class_share_feature_count` | 種類株式で異なる定めができる事項の数 | 9事項 | 9号（役員選任権）は公開会社・指名委員会等設置会社不可 | 会社法108条1項 | verified |
| `registration_deadline_days` | 変更登記の期限（変更が生じた日から） | 14日（2週間）以内 | 全ての登記事項の変更 | 会社法915条1項 | verified |
| `registration_deadline_payment_period` | 払込期間を定めた場合の変更登記の起算 | 期間の末日から14日以内 | 払込期間方式 | 会社法915条2項 | verified |
| `registration_deadline_warrant_exercise` | 新株予約権の行使による変更登記 | 毎月末日現在で、当該末日から14日以内 | 新株予約権の行使、取得請求権付株式の取得請求 | 会社法915条3項 | verified |
| `registration_neglect_fine_max_jpy` | 登記懈怠・公告懈怠等の過料の上限 | 1,000,000円 | 代表者等個人 | 会社法976条1号・2号 | verified |
| `reg_tax_capital_increase_rate` | 増資登記の登録免許税率 | 増加資本金額 × 7/1000 | 資本金の増加 | 登録免許税法 別表第一 24(一)ニ | verified |
| `reg_tax_capital_increase_min_jpy` | 同 最低税額 | 30,000円（1件） | 同上 | 同上 | verified |
| `reg_tax_warrant_issue_jpy` | 新株予約権発行登記の登録免許税 | 90,000円（1件） | 新株予約権の発行 | 同 24(一)ヌ | verified |
| `reg_tax_officer_change_jpy` | 役員変更登記の登録免許税 | 30,000円（資本金1億円以下は10,000円） | 役員変更 | 同 24(一)カ | verified |
| `reg_tax_other_change_jpy` | その他の変更登記の登録免許税 | 30,000円（1件） | 発行可能株式総数、株式の内容、新株予約権の変更・消滅等 | 同 24(一)ツ | verified |
| `fiea_public_offering_solicitee_min` | 「募集」に該当する勧誘の相手方の人数 | 50名以上（＝少人数私募は49名以下） | 取得者数ではなく勧誘の相手方の数 | 金商法2条3項1号、施行令1条の5 | verified |
| `fiea_private_placement_aggregation_months` | 少人数私募の人数通算期間（同一種類の有価証券） | 発行日以前3か月以内 | 同種の新規発行証券 | 金商法施行令1条の6 | verified |
| `fiea_registration_exempt_below_jpy` | 有価証券届出書が不要となる発行価額の総額 | 1億円未満（**2027-04-01 以降は5億円未満**） | 募集（50名以上）に該当する場合。少人数私募なら金額にかかわらず不要 | 金商法4条1項5号／改正法（令和8年7月15日成立、施行日は金融庁の法律案要綱） | verified |
| `fiea_amount_aggregation_years` | 1億円判定の金額通算期間 | 募集開始日前1年以内の同一種類の募集・売出しを合算 | 新株予約権は行使価額の合計額も合算 | 開示府令2条5項 | verified |
| `fiea_notification_above_jpy` | 有価証券通知書が必要となる発行価額の総額 | 1,000万円超 1億円未満（1,000万円以下は不要） | 募集に該当し届出不要の場合。2027-04-01 以降の扱いは unverified | 金商法4条6項、開示府令4条5項 | verified |
| `fiea_so_exemption` | 役員・使用人への SO 付与の届出免除 | 人数・金額にかかわらず届出不要 | 自社・子会社の取締役・会計参与・監査役・執行役・使用人に対する譲渡禁止付き新株予約権 | 金商法4条1項1号、施行令2条の12第2号、開示府令2条2項・3項 | verified |
| `jkiss_qualified_financing_min_jpy` | J-KISS 2.0 次回株式資金調達（適格資金調達）の最低調達額 | 100,000,000円 | ひな形初期値。契約で変更可 | J-KISS 2.0 発行要項(2)(a)(x) | verified (template) |
| `jkiss_discount_multiplier` | J-KISS 2.0 ディスカウント（次回調達の1株発行価額に乗じる率） | 0.8 | ひな形初期値。契約で変更可。キャップ価額との低い方が転換価額 | 同 (2)(a) | verified (template) |
| `jkiss_conversion_deadline_months` | J-KISS 2.0 転換期限（割当日から） | 18か月 | ひな形の定め | 同 (2)(b) | verified (template) |
| `jkiss_acquisition_cash_multiple` | J-KISS 2.0 支配権移転取引時の金銭取得の倍率（発行価額比） | 2倍 | ひな形の定め | 同 取得条項(a) | verified (template) |
| `jkiss_cap_basis` | J-KISS 2.0 バリュエーションキャップの基準 | ポストマネー（v1.x はプレマネー） | バージョンにより異なる | Coral Capital 公式ページ | verified (template) |
| `jkiss_major_investor_min_jpy` | J-KISS 2.0 主要投資家の最低払込金額 | 5,000,000円 | ひな形初期値 | J-KISS 2.0 投資契約 定義条項 | verified (template) |

## C. 新株予約権・ストックオプション（→ 03）

| rule id | 内容 | 数値/期限 | 適用条件 | 根拠条文 | 確認できたか |
|---|---|---|---|---|---|
| `warrant_issuance_resolution_private` | 新株予約権の募集事項の決定 | 株主総会特別決議 | 非公開会社 | 会社法238条2項、309条2項6号 | verified |
| `warrant_delegation_max_days` | 募集事項決定の委任の有効期間（決議日から割当日まで） | 1年以内 | 非公開会社。行使価額・行使期間は委任不可（下記特例を除く） | 会社法239条1項・3項 | verified |
| `so_pool_company_age_max_years` | SO プール特例（行使価額・行使期間の委任、1年制限の不適用）の対象 | 設立後15年未満 | 経産大臣・法務大臣の確認が必要。割当日の2週間前までに株主へ通知 | 産業競争力強化法21条の19 | verified |
| `warrant_register_creation` | 新株予約権原簿の作成時期 | 発行日以後遅滞なく | 全会社 | 会社法249条 | verified |
| `warrant_holder_effective_date` | 新株予約権者となる日 | 割当日 | — | 会社法245条1項 | verified |
| `warrant_exercise_shareholder_date` | 行使により株主となる日 | 行使日（行使日に行使価額全額を払込み） | — | 会社法281条1項、282条1項 | verified |
| `warrant_lapse` | 行使できなくなった新株予約権 | 当然に消滅（消滅から14日以内に変更登記） | — | 会社法287条、915条1項 | verified |
| `warrant_issue_registration_days` | 新株予約権発行の登記期限（割当日から） | 14日以内 | — | 会社法911条3項12号、915条1項 | verified |
| `director_so_remuneration_resolution` | 取締役への SO 付与の報酬決議 | 株主総会普通決議（数の上限等）又は定款 | 取締役への付与 | 会社法361条1項4号 | verified |
| `tqso_free_issuance_required` | 税制適格: 無償発行であること | 金銭の払込み・資産の給付なし | — | 措法29条の2第1項、措令19条の3第1項 | verified |
| `tqso_eligible_grantee` | 税制適格: 付与対象者 | 発行会社・50%超子会社の取締役・執行役・使用人（監査役は条文上含まれない）、認定計画に基づく社外高度人材 | — | 措法29条の2第1項、措令19条の3第2項 | verified |
| `tqso_major_shareholder_threshold_unlisted` | 税制適格: 大口株主（対象外）の基準・未上場 | 発行済株式総数の1/3超（付与決議日時点） | 未上場会社。特別関係者（親族等）も対象外 | 措令19条の3第3項2号・4項 | verified |
| `tqso_major_shareholder_threshold_listed` | 同・上場 | 発行済株式総数の1/10超 | 上場・店頭登録会社 | 措令19条の3第3項1号 | verified |
| `tqso_exercise_start_years` | 税制適格: 行使開始 | 付与決議の日後2年を経過した日以降 | — | 措法29条の2第1項1号 | verified |
| `tqso_exercise_end_years` | 税制適格: 行使期限 | 付与決議の日後10年を経過する日まで | 原則 | 同上 | verified |
| `tqso_exercise_end_years_young_unlisted` | 同・延長 | 付与決議の日後15年を経過する日まで | 付与決議日に設立後5年未満 かつ 未上場（上場・店頭登録なし） | 同上、措規11条の3第2項 | verified |
| `tqso_annual_exercise_limit_jpy` | 税制適格: 年間権利行使価額の上限（基本） | 12,000,000円 | 下記以外 | 措法29条の2第1項ただし書・2号 | verified |
| `tqso_annual_limit_divisor_under5y` | 同・判定時の除数（実質上限2,400万円） | 行使価額÷2 | 付与決議日に設立後5年未満（上場・未上場の別なし） | 措法29条の2第1項ただし書 | verified |
| `tqso_annual_limit_divisor_5to20y` | 同・判定時の除数（実質上限3,600万円） | 行使価額÷3 | 付与決議日に設立後5年以上20年未満 かつ（未上場 又は 上場後5年未満） | 同上、措規11条の3第1項 | verified |
| `tqso_annual_limit_rounding` | 同・除算の端数処理 | 1回の行使の行使価額合計ごとに除し、1円未満切上げ | — | 経産省ページ・国税庁 Q&A（運用上の取扱い） | verified |
| `tqso_annual_limit_breach_effect` | 上限超過時の効果 | 超過することとなる行使の経済的利益全体が非課税対象外 | 他社付与分を含め暦年で通算 | 措法29条の2第1項ただし書 | verified |
| `tqso_exercise_price_min` | 税制適格: 行使価額の下限 | 付与契約締結時の1株当たり価額以上 | 未上場は財産評価基本通達の例による算定（特例方式）可。純資産価額マイナス時は備忘価額1円以上 | 措法29条の2第1項3号、措置法通達（令和5年7月7日改正）、国税庁 Q&A 問7〜9 | verified |
| `tqso_valuation_contract_date_grace_months` | 「契約締結時」を決議日とみなせる期間 | 決議日から6か月を経過していない場合 | — | 国税庁 Q&A 問7 注 | verified |
| `tqso_nav_interim_closing_trigger` | 純資産価額方式で仮決算が必要となる条件 | 付与契約日が直前期末から6か月経過 かつ 純資産価額が直前期末の2倍超（又は期末後に株式発行） | 特例方式 | 国税庁 Q&A 問8 注1 | verified |
| `tqso_transfer_prohibited` | 税制適格: 譲渡禁止 | 必須 | — | 措法29条の2第1項4号 | verified |
| `tqso_share_custody` | 税制適格: 行使で取得した株式の保管・管理 | (イ)証券会社等への保管委託等 又は (ロ)発行会社による管理（譲渡制限株式に限る・区分管理帳簿） | 取得後直ちに。令和6年分以後 | 措法29条の2第1項6号 | verified |
| `tqso_grant_report_due` | 特定新株予約権の付与に関する調書の提出期限 | 付与した日の属する年の翌年1月31日 | 付与会社 | 措法29条の2第6項 | verified |
| `tqso_share_movement_report_due` | 特定株式等の異動状況に関する調書の提出期限 | 毎年1月31日 | 保管する証券会社等、又は自社管理する発行会社 | 措法29条の2第7項 | verified |
| `tqso_transition_deadline` | 令和6年度改正の経過措置（既存契約の変更期限） | 2024-12-31（終了済み） | 2024-03-31 以前締結の契約 | 経産省ページ・国税庁 Q&A | verified |
| `tqso_outside_talent_requirements` | 社外高度人材の具体的要件 | — | 認定社外高度人材活用新事業分野開拓計画 | 中小企業等経営強化法・同省令 | unverified |
| `so_trust_type_tax` | 信託型 SO（税制非適格）の行使時課税 | 給与所得として課税（会社に源泉徴収義務） | 国税庁見解 | 国税庁 Q&A 問3 | verified |
| `so_paid_type_tax` | 有償 SO（時価発行）の行使時課税 | 課税なし（売却時に譲渡所得） | 適正な時価で有償取得 | 国税庁 Q&A 問2 | verified |

## D. 株主総会（→ 04）

| rule id | 内容 | 数値/期限 | 適用条件 | 根拠条文 | 確認できたか |
|---|---|---|---|---|---|
| `agm_deadline_months_after_fy_end` | 定時株主総会の開催期限 | 事業年度末から3か月以内 | 議決権基準日を事業年度末日とする場合（124条2項からの帰結。296条は「一定の時期」） | 会社法124条2項、296条1項 | verified |
| `agm_notice_days_public` | 招集通知の発送期限 | 14日（2週間前まで） | 公開会社 | 会社法299条1項 | verified |
| `agm_notice_days_private_board` | 同 | 7日（1週間前まで） | 非公開・取締役会設置会社 | 会社法299条1項 | verified |
| `agm_notice_days_private_no_board` | 同 | 7日（定款で短縮可・定款可変） | 非公開・取締役会非設置会社 | 会社法299条1項かっこ書 | verified |
| `agm_notice_days_written_or_evote` | 同 | 14日（2週間前まで） | 書面投票・電子投票を定めた場合（会社類型不問） | 会社法299条1項かっこ書 | verified |
| `agm_notice_day_count_method` | 「○週間前まで」の数え方 | 発送日と総会日の間に中N×7日（発送期限日＝総会日−(N×7+1)日） | — | 解釈（条文に明記なし） | unverified |
| `agm_notice_written_required` | 招集通知を書面（又は承諾を得た電磁的方法）で行う義務 | 必須 | 取締役会設置会社、又は書面・電子投票を定めた場合 | 会社法299条2項・3項 | verified |
| `agm_notice_waiver` | 招集手続の省略 | 株主全員の同意 | 書面投票・電子投票を定めた場合は不可 | 会社法300条 | verified |
| `mandatory_written_voting_shareholders` | 書面投票が義務となる株主数 | 1,000人以上 | 議決権を有する株主数 | 会社法298条2項 | verified |
| `ordinary_resolution_quorum` | 普通決議の定足数 | 議決権の過半数（定款で変更・排除可） | — | 会社法309条1項 | verified |
| `ordinary_resolution_threshold` | 普通決議の賛成 | 出席議決権の過半数 | — | 会社法309条1項 | verified |
| `officer_election_quorum_floor` | 役員選任・解任決議の定足数の定款による下限 | 議決権の1/3以上 | 取締役・会計参与・監査役の選任、取締役・会計参与の解任 | 会社法341条 | verified |
| `special_resolution_quorum` | 特別決議の定足数 | 議決権の過半数（定款で1/3以上まで緩和可） | — | 会社法309条2項 | verified |
| `special_resolution_threshold` | 特別決議の賛成 | 出席議決権の2/3以上（定款で引上げ可） | — | 会社法309条2項 | verified |
| `extraordinary_resolution_3_threshold` | 特殊決議（309条3項） | 議決権を行使できる株主の半数以上（頭数）かつ議決権の2/3以上 | 全株式に譲渡制限を設ける定款変更等 | 会社法309条3項 | verified |
| `extraordinary_resolution_4_threshold` | 特殊決議（309条4項） | 総株主の半数以上（頭数）かつ総株主の議決権の3/4以上 | 非公開会社の属人的定めに関する定款変更 | 会社法309条4項 | verified |
| `written_resolution_shareholders` | 株主総会の書面決議 | 議決権を行使できる株主全員の書面又は電磁的記録による同意（定款の定め不要） | — | 会社法319条1項 | verified |
| `written_resolution_retention_years` | 書面決議の同意書面の本店備置き | 10年 | みなし決議日から | 会社法319条2項 | verified |
| `minutes_retention_years` | 株主総会議事録の本店備置き | 10年 | 総会の日から | 会社法318条2項 | verified |
| `minutes_retention_years_branch` | 株主総会議事録（写し）の支店備置き | 5年 | 電磁的記録で一定の措置をとる場合は不要 | 会社法318条3項 | verified |
| `proxy_retention_months` | 委任状・議決権行使書面・電子投票記録の本店備置き | 3か月 | 総会の日から | 会社法310条6項、311条3項、312条4項 | verified |
| `written_vote_deadline` | 書面・電子投票の行使期限 | 総会の日時の直前の営業時間の終了時（特定の時を定めた場合はその時） | — | 施規69条、70条 | verified |
| `proposal_right_voting_pct` | 議題提案権・議案要領通知請求権の持株要件 | 議決権の1%以上 又は 300個以上（定款で引下げ可） | 取締役会設置会社。非設置会社は単独株主権 | 会社法303条2項、305条1項 | verified |
| `proposal_right_holding_months` | 同 保有期間 | 6か月（**非公開会社は不要**） | 公開会社のみ | 会社法303条3項、305条2項 | verified |
| `proposal_deadline_weeks_before` | 同 請求期限 | 総会の日の8週間前まで（定款で短縮可） | — | 会社法303条2項、305条1項 | verified |
| `proposal_max_count` | 議案要領通知請求できる議案数 | 10まで | 取締役会設置会社 | 会社法305条4項 | verified |
| `proposal_repeat_block` | 同一議案の再提案制限 | 議決権の1/10以上の賛成を得られなかった日から3年 | — | 会社法304条ただし書、305条6項 | verified |
| `meeting_demand_voting_pct` | 株主総会招集請求権 | 議決権の3%以上（公開会社は6か月保有。**非公開会社は不要**） | — | 会社法297条1項・2項 | verified |
| `meeting_demand_notice_weeks` | 招集請求後、裁判所の許可で株主が招集できる条件 | 請求の日から8週間以内の日を会日とする招集通知が発せられない場合 | — | 会社法297条4項2号 | verified |
| `meeting_inspector_voting_pct` | 総会検査役選任申立て | 議決権の1%以上（公開・取締役会設置会社は6か月保有） | — | 会社法306条1項・2項 | verified |
| `books_inspection_pct` | 会計帳簿閲覧謄写請求権 | 議決権の3%以上 又は 発行済株式（自己株式除く）の3%以上。保有期間不要 | 請求理由の明示要。競業者等は拒絶可 | 会社法433条1項・2項 | verified |
| `business_inspector_pct` | 業務執行検査役選任申立て | 同上 3% | — | 会社法358条1項 | verified |
| `officer_dismissal_suit_pct` | 役員解任の訴え | 3%（公開会社は6か月保有。非公開は不要）。否決の総会の日から30日以内 | — | 会社法854条1項・2項 | verified |
| `dissolution_suit_pct` | 解散の訴え | 議決権の10%以上 又は 発行済株式（自己株式除く）の10%以上 | — | 会社法833条1項 | verified |
| `derivative_suit_holding_months` | 株主代表訴訟・違法行為差止請求の保有期間 | 6か月（**非公開会社は不要**）。持株数要件なし | — | 会社法847条1項・2項、360条1項・2項 | verified |
| `derivative_suit_company_response_days` | 提訴請求後、株主が自ら提訴できるまでの期間 | 60日 | — | 会社法847条3項 | verified |
| `resolution_rescission_suit_months` | 総会決議取消しの訴えの提訴期間 | 決議の日から3か月以内 | — | 会社法831条1項 | verified |
| `cross_shareholding_no_vote_pct` | 相互保有株式の議決権排除の基準 | 総株主の議決権の1/4以上を保有される関係 | — | 会社法308条1項 | verified |

## E. 取締役会・役員（→ 05）

| rule id | 内容 | 数値/期限 | 適用条件 | 根拠条文 | 確認できたか |
|---|---|---|---|---|---|
| `board_min_directors` | 取締役の最低員数 | 取締役会設置: 3人以上／非設置: 1人以上 | — | 会社法331条5項、326条1項 | verified |
| `board_notice_days` | 取締役会の招集通知期限 | 7日（1週間前まで。定款で短縮可・定款可変） | 通知先: 各取締役（監査役設置会社は各監査役も） | 会社法368条1項 | verified |
| `board_notice_waiver` | 招集手続の省略 | 取締役（監査役設置会社は取締役及び監査役）全員の同意 | — | 会社法368条2項 | verified |
| `board_convene_demand_days` | 招集請求後、請求者が自ら招集できる条件 | 請求から5日以内に、請求から2週間以内の日を会日とする招集通知が発せられない場合 | 取締役・監査役・（一定の会社の）株主 | 会社法366条3項、383条3項、367条3項 | verified |
| `board_quorum` | 取締役会の定足数 | 議決に加わることができる取締役の過半数（定款で引上げのみ可） | 特別利害関係取締役を除く | 会社法369条1項・2項 | verified |
| `board_threshold` | 取締役会の可決要件 | 出席取締役の過半数（定款で引上げのみ可） | 同上 | 会社法369条1項 | verified |
| `board_written_resolution` | 取締役会の書面決議 | 議決に加わることができる取締役全員の書面・電磁的記録による同意 ＋ **定款の定め必須** ＋ 監査役設置会社では監査役の異議なし | — | 会社法370条 | verified |
| `board_report_interval_months` | 代表取締役・業務執行取締役の職務執行状況報告 | 3か月に1回以上（報告の省略不可＝実開催が必要） | 取締役会設置会社 | 会社法363条2項、372条2項 | verified |
| `board_minutes_retention_years` | 取締役会議事録・書面決議同意書面の本店備置き | 10年 | 取締役会の日（みなし決議日）から。支店備置き義務なし | 会社法371条1項 | verified |
| `board_minutes_signature` | 取締役会議事録の署名 | 出席した取締役及び監査役の署名又は記名押印。電磁的記録は電子署名 | — | 会社法369条3項・4項、施規225条 | verified |
| `board_minutes_shareholder_access` | 株主による取締役会議事録の閲覧 | 権利行使に必要なとき。監査役設置会社等は裁判所の許可が必要（会計限定監査役のみの会社は不要） | — | 会社法371条2項・3項、2条9号 | verified |
| `conflict_transaction_approval_organ` | 競業・利益相反取引の承認機関 | 取締役会設置: 取締役会（事後報告も必要）／非設置: 株主総会 | — | 会社法356条1項、365条 | verified |
| `director_term_years` | 取締役の任期 | 選任後2年以内に終了する最終事業年度に関する定時総会終結時まで（短縮可） | 原則 | 会社法332条1項 | verified |
| `director_term_max_years_private` | 取締役の任期の伸長上限 | 10年（定款可変） | 非公開会社（監査等委員会・指名委員会等設置会社を除く） | 会社法332条2項 | verified |
| `auditor_term_years` | 監査役の任期 | 選任後4年以内に終了する最終事業年度に関する定時総会終結時まで（短縮不可） | 原則 | 会社法336条1項 | verified |
| `auditor_term_max_years_private` | 監査役の任期の伸長上限 | 10年（定款可変） | 非公開会社 | 会社法336条2項 | verified |
| `officer_term_end_on_going_public` | 譲渡制限廃止（公開会社化）の定款変更時 | 取締役・監査役の任期が満了 | — | 会社法332条7項3号、336条4項4号 | verified |
| `officer_change_registration_days` | 役員変更（重任を含む）の登記期限 | 14日以内 | — | 会社法915条1項 | verified |
| `dormant_company_years` | 休眠会社となる期間（最後の登記から） | 12年 | 株式会社 | 会社法472条1項 | verified |
| `dormant_company_response_months` | みなし解散の公告から届出・登記までの期間 | 2か月 | — | 会社法472条1項 | verified |
| `dormant_company_continuation_years` | みなし解散後に継続決議ができる期間 | 3年以内 | 株主総会特別決議 | 会社法473条、309条2項11号 | verified |

## F. 決算・開示（→ 06）

| rule id | 内容 | 数値/期限 | 適用条件 | 根拠条文 | 確認できたか |
|---|---|---|---|---|---|
| `fs_retention_years` | 計算書類・附属明細書の保存 | 10年（作成時から） | — | 会社法435条4項 | verified |
| `books_retention_years` | 会計帳簿・事業に関する重要な資料の保存 | 10年（帳簿閉鎖時から） | — | 会社法432条2項 | verified |
| `fiscal_year_max_months` | 事業年度の上限 | 12か月（決算期変更後最初の事業年度は18か月） | — | 計規59条2項 | verified |
| `audit_report_due_days` | 監査役の監査報告の通知期限 | 計算書類全部の受領から4週間経過日／附属明細書受領から1週間経過日／合意した日 のいずれか遅い日 | 監査役設置会社（会計限定含む）・会計監査人非設置 | 計規124条1項、施規132条1項 | verified |
| `fs_display_start_days_board` | 計算書類等の本店備置き開始 | 定時総会の2週間前の日から | 取締役会設置会社 | 会社法442条1項1号 | verified |
| `fs_display_start_days_no_board` | 同 | 定時総会の1週間前の日から | 取締役会非設置会社 | 同上 | verified |
| `fs_display_start_written_resolution` | 同（書面決議の場合） | 提案があった日から | 319条1項の場合 | 同上かっこ書 | verified |
| `fs_display_years_head_office` | 計算書類等の本店備置期間 | 5年 | — | 会社法442条1項 | verified |
| `fs_display_years_branch` | 計算書類等（写し）の支店備置期間 | 3年 | — | 会社法442条2項 | verified |
| `fs_delivery_with_notice` | 招集通知に際しての計算書類・事業報告（監査報告含む）の提供 | 必須 | 取締役会設置会社の定時総会 | 会社法437条 | verified |
| `financial_notice_timing` | 決算公告の時期 | 定時総会の終結後遅滞なく | 全株式会社（有報提出会社を除く） | 会社法440条1項・4項 | verified |
| `financial_notice_content` | 決算公告の内容 | 官報・日刊新聞: 貸借対照表の要旨／電子公告: 貸借対照表全文（大会社は損益計算書も） | 公告方法による | 会社法440条1項・2項 | verified |
| `financial_notice_web_years` | 電子公告・ウェブ掲載による決算公告の継続期間 | 定時総会終結の日後5年を経過する日まで | — | 会社法440条3項、940条1項2号 | verified |
| `default_public_notice_method` | 定款に定めがない場合の公告方法 | 官報 | — | 会社法939条4項 | verified |
| `large_company_capital_jpy` | 大会社の基準（資本金） | 5億円以上（最終事業年度の貸借対照表） | 大会社は非公開でも会計監査人設置義務 | 会社法2条6号、328条2項 | verified |
| `large_company_liabilities_jpy` | 大会社の基準（負債） | 200億円以上 | 同上 | 同上 | verified |
| `corporate_tax_filing_months` | 法人税確定申告期限 | 事業年度終了の日の翌日から2か月以内 | 確定した決算に基づく | 法人税法74条1項 | verified |
| `corporate_tax_extension_months` | 申告期限の延長の特例 | 1か月（会計監査人設置会社で一定の場合は最長4か月） | 定款等により2か月以内に定時総会が招集されない常況。事業年度終了の日までに申請 | 法人税法75条の2第1項・3項 | verified |
| `privacy_third_party_exception` | 個人データの第三者提供に本人同意が不要な場合 | 法令に基づく場合 | 会社法125条の閲覧請求への対応が該当するとの整理は解釈 | 個情法27条1項1号 | verified（条文）／unverified（株主名簿への当てはめ） |
| `investor_information_rights` | 月次・四半期情報等の提供義務 | 法定なし（契約による） | 投資契約・株主間契約 | — | unverified（一般的実務） |

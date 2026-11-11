// 文書テンプレートの「差し込み項目」の一覧。サーバ依存なし。
//
// テンプレートの文面には、差し込み項目を {{会社名}} のように書く。文書を作るときに、台帳の値に置き換える
// （置き換えは fill.ts、値の組み立ては values.ts）。AI にひな形を書かせるときも、ここの一覧だけを使わせる。
//
// 置き換わる値の形（format）:
//   text   … 文字（会社名・議長など）
//   date   … 和暦（令和8年6月26日）。名前に「（西暦）」を付けると 2026年6月26日
//   amount … 金額。数字だけ（10,000,000）。単位は文面に書く（金{{投資額}}円）
//   number … 数。数字だけ（9,000）。単位は文面に書く（{{議決権の総数}}個）
//   list   … 複数行（議案・投資家の一覧）。その行だけに単独で書く
// 項目を足すときは、values.ts で値を入れること（入れ忘れは values.test.ts が見つける）。

import { formatDateJa, formatDateWareki } from '@/lib/equity/format';

/** 値の出どころ。テンプレートの種類ごとに、使える出どころが決まる（kinds.ts） */
export type PlaceholderScope =
  | 'company'
  | 'meeting'
  | 'shareholder_meeting'
  | 'board_meeting'
  | 'convertible_round'
  | 'investment';

export type PlaceholderFormat = 'text' | 'date' | 'amount' | 'number' | 'list';

export interface PlaceholderDef {
  name: string;
  scope: PlaceholderScope;
  format: PlaceholderFormat;
  /** 何に置き換わるか（画面の一覧と、AI への説明に使う） */
  description: string;
  /** 置き換わったあとの例（画面の一覧・見本の表示に使う） */
  example: string;
}

export const PLACEHOLDER_SCOPE_LABELS: Record<PlaceholderScope, string> = {
  company: '会社',
  meeting: '会議',
  shareholder_meeting: '株主総会',
  board_meeting: '取締役会',
  convertible_round: '転換型証券の回次',
  investment: '投資家（1 名ずつ）',
};

/** 「（西暦）」を付けた名前。日付の項目は、和暦と西暦の 2 つの名前を持つ */
export const WESTERN_SUFFIX = '（西暦）';

interface BaseDef {
  name: string;
  scope: PlaceholderScope;
  format: PlaceholderFormat;
  description: string;
  /** 例。日付は YYYY-MM-DD で書く（和暦と西暦の例を、ここから作る） */
  sample: string;
}

const BASE: readonly BaseDef[] = [
  // ---- 会社（どの種類のテンプレートでも使える） ----
  { name: '会社名', scope: 'company', format: 'text', description: '商号', sample: '株式会社サンプル' },
  { name: '本店所在地', scope: 'company', format: 'text', description: '本店の所在地', sample: '東京都千代田区丸の内一丁目1番1号' },
  { name: '代表者', scope: 'company', format: 'text', description: '代表者の役職と氏名', sample: '代表取締役　山田 太郎' },
  { name: '代表者の役職', scope: 'company', format: 'text', description: '代表者の役職', sample: '代表取締役' },
  { name: '代表者の氏名', scope: 'company', format: 'text', description: '代表者の氏名', sample: '山田 太郎' },
  { name: '作成日', scope: 'company', format: 'date', description: '文書を作った日', sample: '2026-06-10' },

  // ---- 会議（株主総会・取締役会で共通） ----
  { name: '会議の名称', scope: 'meeting', format: 'text', description: '会議の名称', sample: '第3期 定時株主総会' },
  { name: '会議の種類', scope: 'meeting', format: 'text', description: '定時株主総会・臨時株主総会・種類株主総会・取締役会', sample: '定時株主総会' },
  { name: '開催日', scope: 'meeting', format: 'date', description: '開催日（書面決議では、決議があったものとみなされる日）', sample: '2026-06-26' },
  { name: '開催日時', scope: 'meeting', format: 'text', description: '開催日（和暦・曜日つき）と開始時刻', sample: '令和8年6月26日（金曜日）午前10時00分' },
  { name: '開始時刻', scope: 'meeting', format: 'text', description: '開始時刻', sample: '午前10時00分' },
  { name: '開催場所', scope: 'meeting', format: 'text', description: '会議の場所', sample: '東京都千代田区丸の内一丁目1番1号 当社本店会議室' },
  { name: '開催方法', scope: 'meeting', format: 'text', description: '会場で開催・オンラインで開催・併用・書面決議', sample: '会場で開催' },
  { name: '招集通知の発送日', scope: 'meeting', format: 'date', description: '招集通知を発送した日', sample: '2026-06-10' },
  { name: '議長', scope: 'meeting', format: 'text', description: '議長の氏名', sample: '山田 太郎' },
  { name: '議事録の作成者', scope: 'meeting', format: 'text', description: '議事録の作成に係る職務を行った取締役の氏名', sample: '山田 太郎' },
  { name: '出席した役員', scope: 'meeting', format: 'text', description: '出席した取締役・監査役の氏名', sample: '代表取締役 山田 太郎、取締役 鈴木 花子、監査役 佐藤 一郎' },
  { name: '報告事項', scope: 'meeting', format: 'list', description: '報告事項の一覧（無ければ「なし」）', sample: '1. 第3期（2025年4月1日から2026年3月31日まで）事業報告の件' },
  { name: '決議事項', scope: 'meeting', format: 'list', description: '決議事項の一覧（第1号議案…）', sample: '第1号議案　第3期計算書類承認の件\n第2号議案　取締役3名選任の件' },
  {
    name: '議案の内容',
    scope: 'meeting',
    format: 'list',
    description: '決議事項ごとの、議案の内容',
    sample: '第1号議案　第3期計算書類承認の件\n　第3期の貸借対照表、損益計算書、株主資本等変動計算書および個別注記表の承認を求めるもの。',
  },
  {
    name: '議案と結果',
    scope: 'meeting',
    format: 'list',
    description: '議案ごとの内容と、採決の結果（賛成・反対・棄権の数）',
    sample: '第1号議案　第3期計算書類承認の件\n　結果: 可決（普通決議。賛成 9,000 個、反対 0 個、棄権 0 個）',
  },

  // ---- 株主総会 ----
  { name: '事業年度', scope: 'shareholder_meeting', format: 'text', description: '対象の事業年度の名称（定時株主総会）', sample: '第3期' },
  { name: '基準日', scope: 'shareholder_meeting', format: 'date', description: '基準日', sample: '2026-03-31' },
  { name: '株主の総数', scope: 'shareholder_meeting', format: 'number', description: '議決権を行使できる株主の数（出欠の表の人数）', sample: '5' },
  { name: '議決権の総数', scope: 'shareholder_meeting', format: 'number', description: '議決権を行使できる株主の議決権の総数', sample: '10,000' },
  { name: '出席株主数', scope: 'shareholder_meeting', format: 'number', description: '出席した株主の数（書面決議では、同意した株主の数）', sample: '4' },
  { name: '出席議決権数', scope: 'shareholder_meeting', format: 'number', description: '出席した株主の議決権の数（委任状・書面による議決権行使を含む）', sample: '9,000' },

  // ---- 取締役会 ----
  { name: '取締役の総数', scope: 'board_meeting', format: 'number', description: '議決に加わることができる取締役の数', sample: '3' },
  { name: '出席取締役数', scope: 'board_meeting', format: 'number', description: '出席した取締役の数（書面決議では、同意した取締役の数）', sample: '3' },

  // ---- 転換型証券の回次（J-KISS など） ----
  { name: '回次の名称', scope: 'convertible_round', format: 'text', description: '回次の名称', sample: '第1回 J-KISS 型新株予約権' },
  { name: '証券の種類', scope: 'convertible_round', format: 'text', description: 'J-KISS 型新株予約権・転換社債型新株予約権付社債など', sample: 'J-KISS 型新株予約権' },
  { name: '評価上限額', scope: 'convertible_round', format: 'amount', description: '評価上限額（バリュエーションキャップ）', sample: '300,000,000' },
  { name: '評価上限額の基準', scope: 'convertible_round', format: 'text', description: 'ポストマネー・プレマネー', sample: 'ポストマネー' },
  { name: 'ディスカウント率', scope: 'convertible_round', format: 'number', description: 'ディスカウント（%）', sample: '20' },
  { name: '転換価額の乗率', scope: 'convertible_round', format: 'number', description: '次回の資金調達の 1 株あたり発行価額に掛ける率（1 − ディスカウント）', sample: '0.8' },
  { name: '適格資金調達の金額', scope: 'convertible_round', format: 'amount', description: '適格資金調達（次回の株式での資金調達）とする金額', sample: '100,000,000' },
  { name: '発行日', scope: 'convertible_round', format: 'date', description: '発行日（割当日）', sample: '2026-07-01' },
  { name: '転換期限', scope: 'convertible_round', format: 'date', description: '転換期限', sample: '2028-01-01' },
  { name: '登記の期限', scope: 'convertible_round', format: 'date', description: '発行の登記の期限（割当日から 2 週間）', sample: '2026-07-15' },
  { name: '投資家の数', scope: 'convertible_round', format: 'number', description: 'この回次の投資家の数', sample: '2' },
  { name: '投資額の合計', scope: 'convertible_round', format: 'amount', description: 'この回次の投資額（払込金額）の合計', sample: '30,000,000' },
  {
    name: '投資家の一覧',
    scope: 'convertible_round',
    format: 'list',
    description: '投資家ごとの名称・投資額・払込日',
    sample: '株式会社シードファンド　金20,000,000円（払込日: 令和8年7月1日）\n田中 次郎　金10,000,000円（払込日: 令和8年7月1日）',
  },

  // ---- 投資家（1 名ずつ文書を作る種類だけ） ----
  { name: '投資家名', scope: 'investment', format: 'text', description: '投資家の氏名・名称', sample: '株式会社シードファンド' },
  { name: '投資家の住所', scope: 'investment', format: 'text', description: '投資家の住所', sample: '東京都港区六本木一丁目1番1号' },
  { name: '投資額', scope: 'investment', format: 'amount', description: 'この投資家の投資額（払込金額）', sample: '20,000,000' },
  { name: '払込日', scope: 'investment', format: 'date', description: '払込日', sample: '2026-07-01' },
];

/** すべての差し込み項目。日付の項目は、和暦の名前のあとに「（西暦）」の名前を並べる */
export const PLACEHOLDERS: readonly PlaceholderDef[] = BASE.flatMap((base): PlaceholderDef[] => {
  if (base.format !== 'date') {
    return [{ name: base.name, scope: base.scope, format: base.format, description: base.description, example: base.sample }];
  }
  return [
    { name: base.name, scope: base.scope, format: 'date', description: base.description, example: formatDateWareki(base.sample) },
    {
      name: `${base.name}${WESTERN_SUFFIX}`,
      scope: base.scope,
      format: 'date',
      description: `「${base.name}」を西暦で`,
      example: formatDateJa(base.sample),
    },
  ];
});

const BY_NAME = new Map(PLACEHOLDERS.map((def) => [def.name, def]));

export const findPlaceholder = (name: string): PlaceholderDef | undefined => BY_NAME.get(name);

/** 出どころの一覧に入る差し込み項目（一覧の順のまま） */
export const placeholdersFor = (scopes: readonly PlaceholderScope[]): PlaceholderDef[] =>
  PLACEHOLDERS.filter((def) => scopes.includes(def.scope));

/** 文面に書く形（{{会社名}}） */
export const placeholderToken = (name: string): string => `{{${name}}}`;

/** 値が無いときに文面に残す印。文書を作った人が、自分で埋める */
export const needsReviewMark = (what: string): string => `【要確認: ${what}】`;

/** 文面の中の「【要確認…】」を数える（AI が書いたひな形にも、値が無かった差し込み項目にも付く） */
export const countNeedsReview = (text: string): number => (text.match(/【要確認[^】]*】/g) ?? []).length;

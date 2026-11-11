// 文書テンプレートの種類ごとの設定（何から値を入れるか・記載する事項・人への注意・AI への指示）。サーバ依存なし。
//
// 種類の id と名前は src/lib/resources/definitions.ts の TEMPLATE_KINDS（DB の check 制約と対）。
// 法令の根拠は docs/legal/（04 株主総会・05 取締役会・02 と 03 の新株予約権の発行）に合わせている。
// 「記載する事項」は、ひな形を確かめる人のための目安で、法的な助言ではない。

import { TEMPLATE_KINDS, type TemplateKindId } from '@/lib/resources/definitions';
import type { PlaceholderScope } from './placeholders';

export type TemplateCategory = 'shareholder_meeting' | 'board_meeting' | 'convertible' | 'other';

export const TEMPLATE_CATEGORIES: readonly { value: TemplateCategory; label: string; description: string }[] = [
  { value: 'shareholder_meeting', label: '株主総会', description: '招集通知・議事録・書面決議・委任状' },
  { value: 'board_meeting', label: '取締役会', description: '招集通知・議事録・書面決議' },
  { value: 'convertible', label: 'J-KISS・転換型証券', description: '条件のまとめ・発行の議案・払込みの案内・契約書' },
  { value: 'other', label: 'その他', description: '会社名や代表者を差し込む、自由な文書' },
];

/** 何を選んで文書を作るか（値の出どころ） */
export type TemplateSubject = 'shareholder_meeting' | 'board_meeting' | 'convertible_round' | 'company';

export interface TemplateKindDef {
  id: TemplateKindId;
  category: TemplateCategory;
  /** 分類の中での短い名前 */
  label: string;
  /** 一覧のカードに出す 1 行の説明 */
  summary: string;
  subject: TemplateSubject;
  /** 投資家 1 名ずつ文書を作る（{{投資家名}} などが使える） */
  perInvestor: boolean;
  /** 根拠の条文（無ければ null） */
  basis: string | null;
  /** 記載する事項（確かめる人のための目安。AI にも渡す） */
  items: readonly string[];
  /** 画面に出す注意 */
  cautions: readonly string[];
  /** AI にひな形を書かせるときの指示。null は「AI には書かせない」（手元の文面からの取り込みだけ） */
  instruction: string | null;
  /** 会議の画面（招集通知・議事録の手順）から使える種類。written は書面決議の会議で使うもの */
  meetingUse: { step: 'notice' | 'minutes'; written: boolean } | null;
}

const SUBJECT_SCOPES: Record<TemplateSubject, readonly PlaceholderScope[]> = {
  shareholder_meeting: ['company', 'meeting', 'shareholder_meeting'],
  board_meeting: ['company', 'meeting', 'board_meeting'],
  convertible_round: ['company', 'convertible_round'],
  company: ['company'],
};

// J-KISS の契約書の本文は、公開元（Coral Capital）のひな形をそのまま使うもの。AI に書かせない・再現させない。
const NO_CONTRACT_TEXT =
  'J-KISS の投資契約書・発行要項の条文は書かない（再現もしない）。新株予約権や契約の内容に触れる必要があるときは、別紙の発行要項・投資契約書を参照する形にとどめる（触れる必要が無ければ、書かない）。';

const KIND_DEFS: Record<TemplateKindId, Omit<TemplateKindDef, 'id'>> = {
  shareholder_notice: {
    category: 'shareholder_meeting',
    label: '招集通知',
    summary: '日時・場所・会議の目的事項を、株主に知らせる通知です。',
    subject: 'shareholder_meeting',
    perInvestor: false,
    basis: '会社法298条1項・299条',
    items: [
      '発信日、宛名（株主各位）、発信者（本店所在地・商号・代表者）',
      '日時と場所（会社法298条1項1号）',
      '会議の目的事項: 報告事項と決議事項（会社法298条1項2号）',
      '議案の内容',
      '出欠の回答の方法（任意）',
      '書面・電磁的方法による議決権行使を定めたときは、その旨（会社法298条1項3号・4号）',
    ],
    cautions: [
      '取締役会設置会社の定時株主総会では、招集通知に際して計算書類・事業報告を提供します（会社法437条）。',
      '電磁的方法（メールなど）で通知するには、株主ごとの承諾が必要です（会社法299条3項）。',
    ],
    instruction:
      '株主総会の招集通知のひな形を書いてください。冒頭に発信日・宛名（株主各位）・発信者（本店所在地、会社名、代表者）を置き、本文で開催を知らせ、「記」以下に日時・場所・会議の目的事項（報告事項・決議事項）・議案の内容を並べ、「以上」で終える。',
    meetingUse: { step: 'notice', written: false },
  },
  shareholder_minutes: {
    category: 'shareholder_meeting',
    label: '議事録',
    summary: '株主総会の議事の経過と結果を残す議事録です。',
    subject: 'shareholder_meeting',
    perInvestor: false,
    basis: '会社法318条1項・会社法施行規則72条3項',
    items: [
      '開催の日時と場所',
      '議事の経過の要領と、その結果',
      '出席した取締役・監査役などの氏名',
      '議長の氏名',
      '議事録の作成に係る職務を行った取締役の氏名',
      '株主の総数・議決権の総数と、出席した株主の数・議決権の数（実務上の記載）',
    ],
    cautions: [
      '議事録は、株主総会の日から 10 年間、本店に備え置きます（会社法318条2項）。',
      '会社法上、株主総会議事録への署名・記名押印の義務はありません。定款に定めがあれば、それに従います。登記に添付するときの押印は、司法書士に確認してください。',
    ],
    instruction:
      '株主総会議事録のひな形を書いてください。会社法施行規則72条3項の記載事項（開催の日時・場所、議事の経過の要領とその結果、出席した取締役・監査役の氏名、議長の氏名、議事録の作成に係る職務を行った取締役の氏名）を満たす形にする。冒頭に株主の総数・議決権の総数と、出席した株主の数・議決権の数を書き、議長が開会を宣したことに続けて、議案と結果を書く。末尾に、議事録を作成した旨・作成日・会社名・議長・議事録の作成者を置く。',
    meetingUse: { step: 'minutes', written: false },
  },
  shareholder_written_proposal: {
    category: 'shareholder_meeting',
    label: '書面決議の提案書・同意書',
    summary: '株主の全員の同意で決議があったものとみなす（書面決議）ための、提案書と同意書です。',
    subject: 'shareholder_meeting',
    perInvestor: false,
    basis: '会社法319条1項',
    items: [
      '提案の内容（決議事項と、議案の内容）',
      '提案者',
      '同意の回答の期限と方法',
      '同意書（同意する旨・日付・株主の住所と氏名の欄）',
    ],
    cautions: ['議決権を行使できる株主の全員が、書面または電磁的記録で同意したときに限り、決議があったものとみなされます（会社法319条1項）。'],
    instruction:
      '株主総会の書面決議（会社法319条1項）のための、提案書（株主あて）と同意書のひな形を書いてください。提案書には、提案の内容（決議事項と議案の内容）と、同意の回答の期限・方法を書く。続けて「同意書」を置き、提案の内容に同意する旨と、日付・株主の住所・氏名の欄を設ける。',
    meetingUse: { step: 'notice', written: true },
  },
  shareholder_written_minutes: {
    category: 'shareholder_meeting',
    label: '書面決議の議事録',
    summary: '書面決議で決議があったものとみなされたときの議事録です。',
    subject: 'shareholder_meeting',
    perInvestor: false,
    basis: '会社法施行規則72条4項1号',
    items: [
      '決議があったものとみなされた事項の内容',
      '提案をした者の氏名または名称',
      '決議があったものとみなされた日',
      '議事録の作成に係る職務を行った取締役の氏名',
    ],
    cautions: ['書面決議でも、議事録の作成と、10 年間の本店での備置きが必要です（会社法318条2項、同意の書面は319条2項）。'],
    instruction:
      '株主総会の書面決議（会社法319条1項）の議事録のひな形を書いてください。会社法施行規則72条4項1号の記載事項（決議があったものとみなされた事項の内容、提案をした者の氏名または名称、決議があったものとみなされた日、議事録の作成に係る職務を行った取締役の氏名）を満たす形にする。株主の全員から同意を得た旨を書く。',
    meetingUse: { step: 'minutes', written: true },
  },
  shareholder_proxy: {
    category: 'shareholder_meeting',
    label: '委任状',
    summary: '株主が代理人に議決権の行使を委任するための書面です。',
    subject: 'shareholder_meeting',
    perInvestor: false,
    basis: '会社法310条',
    items: [
      '代理人の氏名の欄',
      '委任する事項（どの株主総会の、議決権の行使か）',
      '議案ごとの賛否の指示の欄（任意）',
      '日付、株主の住所・氏名の欄',
    ],
    cautions: [
      '代理権の授与は、株主総会ごとに行います（会社法310条2項）。',
      '定款で代理人の資格を株主に限っているときは、その旨を書き添えます。',
    ],
    instruction:
      '株主総会の委任状のひな形を書いてください。代理人の氏名の欄、委任する事項（{{会議の名称}} およびその延会・継続会での議決権の行使）、決議事項ごとの賛否の指示の欄、日付・株主の住所・氏名の欄を設ける。',
    meetingUse: null,
  },
  shareholder_waiver: {
    category: 'shareholder_meeting',
    label: '招集手続の省略の同意書',
    summary: '株主の全員の同意で、招集の手続を省いて株主総会を開くための同意書です。',
    subject: 'shareholder_meeting',
    perInvestor: false,
    basis: '会社法300条',
    items: [
      '招集の手続を経ることなく開催することに同意する旨',
      '対象の株主総会（日時・場所・会議の目的事項）',
      '日付、株主の住所・氏名の欄',
    ],
    cautions: ['株主の全員の同意が必要です。書面・電磁的方法による議決権行使を定めた株主総会では、省略できません（会社法300条ただし書）。'],
    instruction:
      '株主総会の招集手続の省略（会社法300条）への同意書のひな形を書いてください。対象の株主総会（日時・場所・会議の目的事項）を示し、招集の手続を経ることなく開催することに同意する旨と、日付・株主の住所・氏名の欄を設ける。',
    meetingUse: null,
  },
  board_notice: {
    category: 'board_meeting',
    label: '招集通知',
    summary: '取締役会の日時・場所・目的事項を知らせる通知です。',
    subject: 'board_meeting',
    perInvestor: false,
    basis: '会社法368条1項',
    items: ['日時と場所', '会議の目的事項', '宛名: 取締役（監査役設置会社では、監査役も）'],
    cautions: ['取締役（監査役設置会社では、取締役と監査役）の全員の同意があれば、招集の手続を省略できます（会社法368条2項）。'],
    instruction:
      '取締役会の招集通知のひな形を書いてください。宛名は、取締役各位（材料で監査役設置会社のときは「取締役・監査役各位」）。日時・場所・会議の目的事項を「記」以下に並べ、「以上」で終える。',
    meetingUse: { step: 'notice', written: false },
  },
  board_minutes: {
    category: 'board_meeting',
    label: '議事録',
    summary: '取締役会の議事の経過と結果を残す議事録です。',
    subject: 'board_meeting',
    perInvestor: false,
    basis: '会社法369条3項・会社法施行規則101条3項',
    items: [
      '開催の日時と場所',
      '議事の経過の要領と、その結果',
      '特別の利害関係を有する取締役があるときは、その氏名',
      '議長の氏名',
      '取締役の総数と、出席した取締役の数（実務上の記載）',
      '出席した取締役・監査役が署名または記名押印する欄（会社法369条3項）',
    ],
    cautions: [
      '出席した取締役と監査役は、議事録に署名または記名押印をします（会社法369条3項）。電磁的記録で作るときは、電子署名が必要です（同条4項）。',
      '議事録は、取締役会の日から 10 年間、本店に備え置きます（会社法371条1項）。',
    ],
    instruction:
      '取締役会議事録のひな形を書いてください。会社法施行規則101条3項の記載事項（開催の日時・場所、議事の経過の要領とその結果、特別の利害関係を有する取締役があるときはその氏名、議長の氏名）を満たす形にする。冒頭に取締役の総数と出席した取締役の数を書き、議案と結果を書く。特別の利害関係を有する取締役については【要確認】として欄を設ける。末尾に、出席した取締役・監査役が記名押印する欄を置く。',
    meetingUse: { step: 'minutes', written: false },
  },
  board_written_proposal: {
    category: 'board_meeting',
    label: '書面決議の提案書・同意書',
    summary: '取締役の全員の同意で決議があったものとみなす（書面決議）ための、提案書と同意書です。',
    subject: 'board_meeting',
    perInvestor: false,
    basis: '会社法370条',
    items: ['提案の内容', '提案をした取締役', '同意の回答の期限と方法', '同意書（同意する旨・日付・取締役の氏名の欄）'],
    cautions: [
      '定款に、取締役会の書面決議を認める定めが必要です（会社法370条）。',
      '監査役設置会社では、監査役が異議を述べたときは成立しません（会社法370条）。',
    ],
    instruction:
      '取締役会の書面決議（会社法370条）のための、提案書（取締役あて）と同意書のひな形を書いてください。提案書には、提案の内容と、同意の回答の期限・方法を書く。続けて「同意書」を置き、提案の内容に同意する旨と、日付・取締役の氏名の欄を設ける。材料で監査役設置会社のときは、監査役が異議の有無を回答する欄も設ける。',
    meetingUse: { step: 'notice', written: true },
  },
  board_written_minutes: {
    category: 'board_meeting',
    label: '書面決議の議事録',
    summary: '取締役会の書面決議で、決議があったものとみなされたときの議事録です。',
    subject: 'board_meeting',
    perInvestor: false,
    basis: '会社法施行規則101条4項1号',
    items: [
      '決議があったものとみなされた事項の内容',
      '提案をした取締役の氏名',
      '決議があったものとみなされた日',
      '議事録の作成に係る職務を行った取締役の氏名',
    ],
    cautions: ['書面決議の議事録には出席者がいないため、会社法369条3項の署名・記名押印の義務は、条文上は生じません（実務上は、作成した取締役が記名押印または電子署名をします）。'],
    instruction:
      '取締役会の書面決議（会社法370条）の議事録のひな形を書いてください。会社法施行規則101条4項1号の記載事項（決議があったものとみなされた事項の内容、提案をした取締役の氏名、決議があったものとみなされた日、議事録の作成に係る職務を行った取締役の氏名）を満たす形にする。取締役の全員から同意を得た旨を書く。',
    meetingUse: { step: 'minutes', written: true },
  },
  convertible_terms: {
    category: 'convertible',
    label: '条件のまとめ（記入表）',
    summary: '契約書のひな形の空欄に記入する値を、台帳の条件から一覧にします。',
    subject: 'convertible_round',
    perInvestor: false,
    basis: null,
    items: [
      '発行会社と、回次の名称',
      '評価上限額（バリュエーションキャップ）と、その基準',
      'ディスカウント',
      '適格資金調達の金額',
      '発行日（割当日）と、転換期限',
      '投資家ごとの投資額と払込日',
      '発行のあとの手続き（新株予約権原簿への記載・登記の期限）',
    ],
    cautions: [
      'ここに並ぶのは、台帳に登録した条件です。契約書と食い違うときは、契約書が正しいものとして、台帳を直してください。',
    ],
    instruction: `転換型証券（J-KISS 型新株予約権など）の、条件のまとめ（記入表）のひな形を書いてください。契約書のひな形の空欄に何を記入するかを、項目名と値の一覧にする。構成: 表題、発行会社、回次、条件（評価上限額とその基準、ディスカウント、適格資金調達の金額、発行日、転換期限）、投資家の一覧と投資額の合計、発行のあとの手続き（新株予約権原簿への記載、登記の期限）。${NO_CONTRACT_TEXT}`,
    meetingUse: null,
  },
  convertible_proposal: {
    category: 'convertible',
    label: '発行の議案',
    summary: '株主総会に付議する議案（募集事項の決定と、総数引受契約の承認）の文面です。',
    subject: 'convertible_round',
    perInvestor: false,
    basis: '会社法238条1項・2項、244条、309条2項6号',
    items: [
      '募集新株予約権の内容（別紙の発行要項による）と数',
      '払込金額、またはその算定方法',
      '割当日',
      '払込期日を定めるときは、その期日',
      '割当てを受ける者と、総数引受契約の承認',
    ],
    cautions: [
      '非公開会社では、募集事項の決定は株主総会の特別決議です（会社法238条2項・309条2項6号）。',
      '総数引受契約の承認は、取締役会設置会社では取締役会、それ以外の会社では株主総会の決議です（定款に別段の定めがある場合を除く。会社法244条3項）。',
      'Coral Capital が公開している J-KISS の手続書類は、取締役会を置かない会社向けです。取締役会設置会社は、専門家に確認してください。',
    ],
    instruction: `転換型証券（J-KISS 型新株予約権）の発行について、株主総会に付議する議案のひな形を書いてください。議案の表題（例: {{回次の名称}}の発行の件）、募集事項（募集新株予約権の内容は別紙の発行要項のとおり、数、払込金額、割当日、払込期日）、割当てを受ける者（投資家の一覧）と総数引受契約の締結の承認を書く。新株予約権の数など、差し込み項目に無い事項は【要確認】にする。材料で取締役会設置会社のときは、総数引受契約の承認は取締役会の決議事項である旨の注記を【要確認】として入れる。${NO_CONTRACT_TEXT}`,
    meetingUse: null,
  },
  convertible_payment_notice: {
    category: 'convertible',
    label: '払込みの案内',
    summary: '投資家 1 名ずつに、払込金額・期日・振込先を知らせる案内です。',
    subject: 'convertible_round',
    perInvestor: true,
    basis: null,
    items: ['宛名（投資家）', '払込金額', '払込期日', '振込先の口座（文書を作るときに記入）', '問い合わせ先'],
    cautions: ['振込先の口座は、台帳に持っていません。文書を作るたびに記入してください。'],
    instruction: `転換型証券（J-KISS 型新株予約権）の払込みについて、投資家 1 名にあてた案内のひな形を、です・ます調で書いてください。宛名（{{投資家名}} 御中）、発信者、対象の回次、払込金額、払込期日、振込先の口座（【要確認】として欄を設ける）、問い合わせ先（【要確認】）を書く。${NO_CONTRACT_TEXT}`,
    meetingUse: null,
  },
  convertible_contract: {
    category: 'convertible',
    label: '契約書（手元のひな形から）',
    summary: 'お手元の契約書のひな形（J-KISS など）を貼り付け、空欄を差し込み項目に置き換えます。',
    subject: 'convertible_round',
    perInvestor: true,
    basis: null,
    items: [],
    cautions: [
      'J-KISS の投資契約書・発行要項は、Coral Capital が公開しているひな形を使ってください。このツールに、ひな形は同梱していません。',
      '公開元は、記入する箇所（空欄・角かっこ）のほかを変えるときは、専門家に相談するよう案内しています。',
      'このツールは契約書の文面を書きません。貼り付けた文面の、空欄を置き換えるだけです。',
    ],
    instruction: null,
    meetingUse: null,
  },
  other: {
    category: 'other',
    label: 'その他の文書',
    summary: '会社名・本店所在地・代表者・作成日を差し込む、自由な文書です。',
    subject: 'company',
    perInvestor: false,
    basis: null,
    items: [],
    cautions: [],
    instruction: '利用者の要望に沿って、会社が作る文書のひな形を書いてください。要望が無いときは、発信日・宛名・発信者・本文・「以上」からなる、一般的な通知文のひな形にする。',
    meetingUse: null,
  },
};

export const TEMPLATE_KIND_DEFS: readonly TemplateKindDef[] = TEMPLATE_KINDS.map((option) => ({ id: option.value, ...KIND_DEFS[option.value] }));

export const isTemplateKindId = (value: unknown): value is TemplateKindId =>
  typeof value === 'string' && Object.hasOwn(KIND_DEFS, value);

export const getTemplateKind = (id: TemplateKindId): TemplateKindDef => ({ id, ...KIND_DEFS[id] });

/** 種類の正式な名前（「株主総会の招集通知」）。一覧・監査ログ・AI の指示に使う */
export const templateKindName = (id: string): string => TEMPLATE_KINDS.find((option) => option.value === id)?.label ?? id;

/** その種類のテンプレートで値を入れられる、差し込み項目の出どころ */
export const scopesOfKind = (kind: Pick<TemplateKindDef, 'subject' | 'perInvestor'>): PlaceholderScope[] => [
  ...SUBJECT_SCOPES[kind.subject],
  ...(kind.perInvestor ? (['investment'] as const) : []),
];

export const kindsOfCategory = (category: TemplateCategory): TemplateKindDef[] =>
  TEMPLATE_KIND_DEFS.filter((kind) => kind.category === category);

/** 会議の画面の手順（招集通知・議事録）で使える種類 */
export const meetingKindsFor = (board: boolean, step: 'notice' | 'minutes', written: boolean): TemplateKindId[] =>
  TEMPLATE_KIND_DEFS.filter(
    (kind) =>
      kind.subject === (board ? 'board_meeting' : 'shareholder_meeting') &&
      kind.meetingUse?.step === step &&
      kind.meetingUse.written === written,
  ).map((kind) => kind.id);

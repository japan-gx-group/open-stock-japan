// 法令ガイドに出す文書の一覧（docs/legal/ のうち、ここに書いたものだけ）。サーバ依存なし。
// ファイルの読み込みは docsServer.ts（サーバ専用）が、この一覧のファイル名だけを対象に行う。

export interface LegalDoc {
  /** URL に使う名前 */
  slug: string;
  /** docs/legal/ の中のファイル名（固定。利用者の入力からは作らない） */
  fileName: string;
  title: string;
  summary: string;
}

export const LEGAL_DOCS: readonly LegalDoc[] = [
  {
    slug: 'shareholder-registry',
    fileName: '01-shareholder-registry.md',
    title: '株主名簿・株式の管理',
    summary: '株主名簿の記載事項、名義書換、基準日、譲渡制限株式の譲渡承認、株式の分割・併合、自己株式。',
  },
  {
    slug: 'share-issuance',
    fileName: '02-share-issuance.md',
    title: '募集株式の発行・種類株式・J-KISS・開示規制',
    summary: '第三者割当増資の手続、資本金・資本準備金、発行可能株式総数、種類株式、登記と登録免許税、J-KISS、金融商品取引法の開示規制。',
  },
  {
    slug: 'stock-options',
    fileName: '03-stock-options.md',
    title: '新株予約権・ストックオプション',
    summary: '新株予約権の内容と募集事項の決定、新株予約権原簿、行使・消滅、登記、取締役への付与、税制適格ストックオプションの要件。',
  },
  {
    slug: 'shareholders-meeting',
    fileName: '04-shareholders-meeting.md',
    title: '株主総会',
    summary: '定時・臨時株主総会、招集の決定と招集通知の期限、決議要件、書面決議、議事録、株主提案権、少数株主権。',
  },
  {
    slug: 'board-of-directors',
    fileName: '05-board-of-directors.md',
    title: '取締役会・役員・登記',
    summary: '機関設計、取締役会の権限・招集・決議、書面決議、3 か月に 1 回の報告、議事録、利益相反取引、役員の任期と変更の登記。',
  },
  {
    slug: 'financial-disclosure',
    fileName: '06-financial-disclosure.md',
    title: '決算情報の作成・備置き・株主への開示',
    summary: '計算書類の作成・監査・承認、備置きと閲覧、決算公告、法人税の申告期限、投資契約上の情報請求権、株主情報の取扱い。',
  },
  {
    slug: 'rules',
    fileName: 'rules.md',
    title: '数値ルール一覧',
    summary: 'このソフトウェアが計算に使っている期限・割合・金額の一覧と、根拠条文・確認状況。',
  },
];

export const findLegalDoc = (slug: string): LegalDoc | null => LEGAL_DOCS.find((doc) => doc.slug === slug) ?? null;

/** 文書のファイル名 → 画面のパス（文書どうしのリンクに使う） */
export const LEGAL_DOC_PATHS: ReadonlyMap<string, string> = new Map(LEGAL_DOCS.map((doc) => [doc.fileName, `/legal-guide/${doc.slug}`]));

export const LEGAL_DISCLAIMER =
  'ここにある文書は、非公開会社である株式会社を主な対象とした一般的な要約であり、法的助言・税務助言ではありません。定款や契約に別段の定めがある場合はそちらが優先することがあります。法改正により内容が変わることがあるため、各文書の確認日を確かめ、個別の案件は弁護士・司法書士・税理士などの専門家に確認してください。';

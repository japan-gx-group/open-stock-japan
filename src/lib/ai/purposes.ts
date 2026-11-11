// AI を使う用途の一覧（サーバ専用）。
//
// AI を使う機能は、ここに用途を登録してから共通の入口（generateStructured）を呼ぶ。登録していない用途からは呼べない
// （AiPurposeId が登録済みの id だけになるので、型でも止まる）。登録はコードの変更なので PR のレビューを通る。
// 用途ごとに、送ってよい入力の種類・量、回数の上限、出力の上限を決める。監査ログ（ai.request）には用途の id が残る。

import 'server-only';

export type AiInputKind = 'text' | 'pdf' | 'image';

export interface AiPurpose {
  /** 送信の確認と監査ログの表示に使う名前 */
  label: string;
  /** 送ってよい入力の種類 */
  inputs: readonly AiInputKind[];
  /** 1 回に送れる量の上限（バイト。文字は UTF-8 で数える） */
  maxInputBytes: number;
  /** 組織あたりの回数の上限 */
  limits: { perMinute: number; perDay: number };
  /** 出力の上限（トークン。課金の上限にもなる） */
  maxOutputTokens: number;
}

/** 1 回に送れる量の既定の上限。Vercel の関数の本文の上限（4.5MB）に収めるため 4MB にする */
export const DEFAULT_MAX_INPUT_BYTES = 4 * 1024 * 1024;

/** 用途にかかわらない、組織全体の 24 時間あたりの回数の上限 */
export const AI_ORGANIZATION_DAILY_LIMIT = 500;

// 用途を足すときは、ここに 1 行足す。
export const AI_PURPOSES = {
  // 契約書・議事録・登記事項証明書・決算書などの PDF・画像・文字から、株主・株式・会議・決算の項目を読み取る（AI 取り込み）。
  document_extraction: {
    label: '文書からの読取り',
    inputs: ['pdf', 'image', 'text'],
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    limits: { perMinute: 10, perDay: 200 },
    maxOutputTokens: 8_000,
  },
  // 入力フォームの項目を、貼り付けた文字や添付の資料から埋める候補を出す（入力の補助）。
  form_assist: {
    label: '入力の補助',
    inputs: ['text', 'pdf', 'image'],
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    limits: { perMinute: 20, perDay: 400 },
    maxOutputTokens: 4_000,
  },
  // 招集通知・議事録・株主へのお知らせなどの文章の下書きを作る。
  draft_writing: {
    label: '文章の下書き',
    inputs: ['text'],
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    limits: { perMinute: 10, perDay: 200 },
    maxOutputTokens: 6_000,
  },
  // 文書テンプレート（招集通知・議事録・J-KISS の発行に使う書類のひな形）を書く。手元のひな形の空欄を、
  // 差し込み項目に置き換える案を出す（長い契約書は案の数が多くなるので、出力の上限を広げている）。
  template_writing: {
    label: '文書テンプレートの作成',
    inputs: ['text'],
    maxInputBytes: DEFAULT_MAX_INPUT_BYTES,
    limits: { perMinute: 6, perDay: 100 },
    maxOutputTokens: 12_000,
  },
} satisfies Record<string, AiPurpose>;

export type AiPurposeId = keyof typeof AI_PURPOSES;

/** 登録済みの用途を返す。登録していなければ undefined */
export const findAiPurpose = (id: string): AiPurpose | undefined =>
  Object.prototype.hasOwnProperty.call(AI_PURPOSES, id)
    ? (AI_PURPOSES as Record<string, AiPurpose>)[id]
    : undefined;

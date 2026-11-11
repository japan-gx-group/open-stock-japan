// ブラウザの中で完結する操作（Excel への出力・印刷）を、監査ログに残すための定義（ブラウザ・サーバ共通）。
//
// Excel のファイルは、すでに画面に読み込んだデータからブラウザが作る。サーバを通らないので、
// 出力の前にブラウザが「これから出力する」とサーバへ伝え、記録できたときだけ出力する（src/lib/audit/activityClient.ts）。
// 伝える内容はここの種類に限り、サーバ（src/app/api/activity/route.ts）は形を確かめてから残す。
//
// 限界: 画面のボタンからの出力は必ず記録されるが、API から読んだデータを自分で加工して持ち出す操作までは
// 記録できない（データを読める権限そのものの管理と、ログインの記録で補う。docs/system-audit.md）。

export const ACTIVITY_KINDS = {
  'export.shareholder_registry': '株主名簿を Excel に出力',
  'export.cap_table': '資本政策表を Excel に出力',
  'export.warrant_register': '新株予約権原簿を Excel に出力',
  'print.meeting_minutes': '議事録を印刷用に表示',
} as const;

export type ActivityKind = keyof typeof ACTIVITY_KINDS;

export const isActivityKind = (value: unknown): value is ActivityKind =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACTIVITY_KINDS, value);

export interface ActivityDetail {
  /** 基準日（YYYY-MM-DD）。「すべての異動を反映」のときは null */
  asOf?: string | null;
  /** 出力した行数 */
  rows?: number;
  /** 出力したファイルの名前 */
  fileName?: string;
  /** 対象の記録の id（議事録の会議など） */
  entityId?: string;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** ブラウザから届いた内容のうち、決まった形のものだけを残す（それ以外は捨てる） */
export const sanitizeActivityDetail = (input: unknown): ActivityDetail => {
  if (typeof input !== 'object' || input === null) return {};
  const raw = input as Record<string, unknown>;
  const detail: ActivityDetail = {};
  if (raw.asOf === null) detail.asOf = null;
  if (typeof raw.asOf === 'string' && DATE_PATTERN.test(raw.asOf)) detail.asOf = raw.asOf;
  if (typeof raw.rows === 'number' && Number.isInteger(raw.rows) && raw.rows >= 0 && raw.rows <= 1_000_000) detail.rows = raw.rows;
  if (typeof raw.fileName === 'string' && raw.fileName.trim()) detail.fileName = raw.fileName.trim().slice(0, 200);
  if (typeof raw.entityId === 'string' && UUID_PATTERN.test(raw.entityId)) detail.entityId = raw.entityId;
  return detail;
};

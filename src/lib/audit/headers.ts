// 監査ログのために、リクエストをまたいで受け渡すヘッダの名前（プロキシ・サーバ・DB のトリガーで共通）。
//
// 流れ:
//   1. src/proxy.ts が、セッションを確かめた本人の id を USER_ID_HEADER に入れる
//      （ブラウザが同じ名前のヘッダを送ってきても、必ず消してから入れ直す）。
//   2. src/lib/supabase/admin.ts（service_role のクライアント）が、DB への要求に DB_* のヘッダを付ける。
//   3. DB のトリガー（supabase/migrations/20261111000004_audit_trail.sql の audit_request_info）が、
//      それを読んで「だれが・どこから」を監査ログに残す。
//
// ここを変えるときは、マイグレーションの audit_request_info も合わせて変えること。

import { clientIpFromHeaders } from '@/lib/security/clientIp';

/** プロキシがセッションの本人の id を入れる、アプリ内だけのヘッダ */
export const USER_ID_HEADER = 'x-openstock-user-id';

/** プロキシがリクエストのパスを入れる、アプリ内だけのヘッダ（権限エラーの記録に使う） */
export const PATH_HEADER = 'x-openstock-path';

/**
 * 「このリクエストはプロキシを通った」ことの印を入れる、アプリ内だけのヘッダ。
 * 値はサーバだけが知っている秘密から作る（proxyMarkOf）。プロキシを通らずに届いたリクエストが
 * USER_ID_HEADER・PATH_HEADER を自分で付けてきても、この印が合わなければ使わない。
 */
export const PROXY_MARK_HEADER = 'x-openstock-proxy';

/** ブラウザから届いたら必ず捨てる、アプリ内だけのヘッダ */
export const INTERNAL_HEADERS = [USER_ID_HEADER, PATH_HEADER, PROXY_MARK_HEADER] as const;

let cachedMark: { secret: string; mark: string } | null = null;

/**
 * プロキシの印。サーバ専用の鍵（SUPABASE_SERVICE_ROLE_KEY）から作るので、ブラウザは同じ値を作れない。
 * 鍵が無い環境（CI のビルドなど）では null（＝印なし。操作した人は記録されない）。
 */
export const proxyMarkOf = async (secret: string | undefined = process.env.SUPABASE_SERVICE_ROLE_KEY): Promise<string | null> => {
  if (!secret) return null;
  if (cachedMark?.secret === secret) return cachedMark.mark;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`openstock-proxy-mark:${secret}`));
  const mark = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  cachedMark = { secret, mark };
  return mark;
};

/** DB（PostgREST）へ渡すヘッダ */
export const DB_ACTOR_HEADER = 'x-openstock-actor';
export const DB_IP_HEADER = 'x-openstock-ip';
export const DB_USER_AGENT_HEADER = 'x-openstock-user-agent';
export const DB_REQUEST_ID_HEADER = 'x-openstock-request-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AuditRequestContext {
  /** セッションの本人（プロキシが確かめたもの）。未ログイン・リクエストの外では null */
  actorId: string | null;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  /** リクエストのメソッドとパス（例: 'POST /api/company'）。プロキシを通っていなければ null */
  route: string | null;
}

export const EMPTY_AUDIT_CONTEXT: AuditRequestContext = { actorId: null, ip: null, userAgent: null, requestId: null, route: null };

// HTTP のヘッダに入れられるのは表示できる ASCII だけ。それ以外の文字は落とす（fetch が例外を投げるため）。
const toHeaderValue = (value: string, maxLength: number): string =>
  value.replace(/[^\x20-\x7e]/g, '').trim().slice(0, maxLength);

/**
 * リクエストのヘッダから、監査ログに残す情報を取り出す。
 * viaProxy = false（プロキシの印が合わない）のときは、プロキシが入れるはずの値（操作した人・操作）を使わない。
 */
export const auditContextFromHeaders = (
  headers: { get(name: string): string | null },
  { viaProxy = true }: { viaProxy?: boolean } = {},
): AuditRequestContext => {
  const actor = viaProxy ? (headers.get(USER_ID_HEADER)?.trim() ?? '') : '';
  // 接続元は、信頼できるプロキシが足した位置の値だけを使う（src/lib/security/clientIp.ts）
  const ip = clientIpFromHeaders(headers);
  const userAgent = toHeaderValue(headers.get('user-agent') ?? '', 500);
  const requestId = toHeaderValue(headers.get('x-request-id') ?? '', 100);
  return {
    actorId: UUID_PATTERN.test(actor) ? actor : null,
    ip,
    userAgent: userAgent || null,
    requestId: requestId || null,
    route: viaProxy ? toHeaderValue(headers.get(PATH_HEADER) ?? '', 300) || null : null,
  };
};

/** DB への要求に付けるヘッダ（値の無いものは付けない） */
export const toDbAuditHeaders = (context: AuditRequestContext): Record<string, string> => {
  const result: Record<string, string> = {};
  if (context.actorId) result[DB_ACTOR_HEADER] = context.actorId;
  if (context.ip) result[DB_IP_HEADER] = context.ip;
  if (context.userAgent) result[DB_USER_AGENT_HEADER] = context.userAgent;
  if (context.requestId) result[DB_REQUEST_ID_HEADER] = context.requestId;
  return result;
};

// いま処理しているリクエストの、監査ログに残す情報（操作した人・接続元）を読む（サーバ専用）。
import 'server-only';
import { headers } from 'next/headers';
import { auditContextFromHeaders, EMPTY_AUDIT_CONTEXT, PROXY_MARK_HEADER, proxyMarkOf, type AuditRequestContext } from './headers';

/**
 * Route Handler / Server Action / Server Component の中ではリクエストのヘッダから読む。
 * リクエストの外（スクリプト・テスト・応答を返したあとの処理）では、何も取れないので空を返す。
 *
 * 操作した人（プロキシが入れた id）は、リクエストがプロキシ（src/proxy.ts）を通ったことを印で確かめてから使う。
 * プロキシを通らない経路で届いたリクエストが同じ名前のヘッダを付けていても、操作した人としては使わない。
 */
export const readAuditRequestContext = async (): Promise<AuditRequestContext> => {
  try {
    const requestHeaders = await headers();
    const expected = await proxyMarkOf();
    const viaProxy = expected !== null && requestHeaders.get(PROXY_MARK_HEADER) === expected;
    return auditContextFromHeaders(requestHeaders, { viaProxy });
  } catch {
    return EMPTY_AUDIT_CONTEXT;
  }
};

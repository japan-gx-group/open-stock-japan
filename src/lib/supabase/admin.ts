// Client Component からの import をビルド時に失敗させる（docs/architecture.md をレビュー頼みにしない）。
import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { toDbAuditHeaders } from '@/lib/audit/headers';
import { readAuditRequestContext } from '@/lib/audit/requestContext';

// DB への要求のたびに、いま処理しているリクエストの「操作した人・接続元」をヘッダで付ける。
// DB のトリガーがこれを読んで監査ログに残すので、呼び出し側は何も渡さなくてよい（付け忘れが起きない）。
// 操作した人は、プロキシ（src/proxy.ts）がセッションを確かめて入れた id で、ブラウザからは偽れない。
// リクエストの外（スクリプトなど）では何も付かず、監査ログには「システムの処理」として残る。
const fetchWithAuditContext: typeof fetch = async (input, init) => {
  const auditHeaders = toDbAuditHeaders(await readAuditRequestContext());
  if (Object.keys(auditHeaders).length === 0) return fetch(input, init);
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  for (const [name, value] of Object.entries(auditHeaders)) headers.set(name, value);
  return fetch(input, { ...init, headers });
};

/**
 * service_role キーを使う管理用 Supabase クライアント（サーバ専用）。
 *
 * ⚠️ 重要（docs/architecture.md）:
 * - このファイルは Server Action / Route Handler / サーバサイドのバッチからのみ import すること。
 * - Client Component（'use client'）から絶対に import しないこと。
 * - service_role キーは RLS をバイパスする管理者権限キー。`NEXT_PUBLIC_` 変数にしない・
 *   ブラウザへ露出させない・コミットしないこと（値は .env.local に置く）。
 *
 * 用途は「RLS を意図的に越える必要があるバッチ処理」に限定する（docs/architecture.md）。
 * 認証と RLS ポリシーが整備されたら、ユーザーセッション経由の
 * src/lib/supabase/server.ts への移行を検討する。
 */
export const createAdminClient = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'Supabase の管理クライアントには NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY が必要です（.env.local を確認してください）',
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: { fetch: fetchWithAuditContext },
  });
};

// 操作の記録を監査ログ（system_audit_logs）に残す（サーバ専用）。
//
// 役割の分担:
//   - データの行の変更（追加・更新・削除）は、DB のトリガーが変更前後の値つきで必ず残す（アプリは何もしなくてよい）。
//   - ここで残すのは、DB の行の変更だけでは分からない操作: ダウンロード・出力・権限エラー・パスワードの変更・
//     ログインの失敗・監査ログの閲覧など。
//   - 連番・ハッシュ・記録時刻・接続元（IP アドレス・ブラウザ・リクエストの番号）は DB が付ける。
//
// 記録に失敗しても、呼び出し元の処理は止めない（失敗はサーバのログに残す）。
// 監査ログは追記専用で、あとから直せない。秘密の値（パスワード・トークン・API キー）は detail に入れないこと。

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from '@/lib/logging/logger';
import { createAdminClient } from '@/lib/supabase/admin';

export type AuditOutcome = 'success' | 'failure' | 'denied';

export interface AuditEvent {
  /** 操作の名前。「対象.動作」の形（例: documents.download） */
  action: string;
  /** 対象の種類（テーブル名など） */
  entityName: string;
  entityId?: string | null;
  detail?: Record<string, unknown>;
  outcome?: AuditOutcome;
}

export interface AuditActor {
  organizationId: string;
  /** 操作した人。決まらないとき（ログインの失敗・共有リンクからのアクセス）は null */
  userId: string | null;
  /**
   * その時点のメールアドレスとロール。ふつうは渡さない（DB が profiles から引く）。
   * 渡すのは、profiles に行が無い場合だけ（退会の直後、ログインに失敗したメールアドレスなど）。
   */
  email?: string;
  role?: string;
}

export const recordAuditEvent = async (
  actor: AuditActor,
  event: AuditEvent,
  admin?: SupabaseClient,
): Promise<boolean> => {
  try {
    const client = admin ?? createAdminClient();
    const { error } = await client.from('system_audit_logs').insert({
      organizationId: actor.organizationId,
      userId: actor.userId,
      action: event.action,
      entityName: event.entityName,
      entityId: event.entityId ?? null,
      detail: JSON.stringify(event.detail ?? {}),
      ...(event.outcome && event.outcome !== 'success' ? { outcome: event.outcome } : {}),
      ...(actor.email ? { actorEmail: actor.email } : {}),
      ...(actor.role ? { actorRole: actor.role } : {}),
    });
    if (error) {
      logger.error({ error, action: event.action }, '監査ログの記録に失敗しました');
      return false;
    }
    return true;
  } catch (error) {
    logger.error({ error, action: event.action }, '監査ログの記録に失敗しました');
    return false;
  }
};

/** 操作した人の id だけが分かっているとき。所属の組織を profiles から引いて残す（行が無ければ残さない） */
export const recordAuditEventForUser = async (userId: string, event: AuditEvent, admin?: SupabaseClient): Promise<boolean> => {
  try {
    const client = admin ?? createAdminClient();
    const { data } = await client.from('profiles').select('organizationId').eq('id', userId).maybeSingle();
    const organizationId = (data as { organizationId?: string } | null)?.organizationId;
    if (!organizationId) return false;
    return await recordAuditEvent({ organizationId, userId }, event, client);
  } catch (error) {
    logger.error({ error, action: event.action }, '監査ログの記録に失敗しました');
    return false;
  }
};
